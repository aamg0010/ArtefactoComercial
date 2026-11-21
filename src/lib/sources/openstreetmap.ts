import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { setTimeout as wait } from 'node:timers/promises';
import { corporateEmail, businessPhone } from '../company-contact';
import { normalizeText } from '../normalization';
import { SourceError } from './google-places';
import { type SourceAdapter, type SearchCriteria, type CandidateCompany, candidateSchema } from './types';

export const osmAttribution = '© colaboradores de OpenStreetMap, ODbL';
export function osmTagFilters(keyword: string): [string, string][] {
  const key = normalizeText(keyword);
  if (/bodega|vino|vinic/.test(key)) return [['craft', 'winery'], ['industrial', 'winery'], ['shop', 'wine']];
  if (/almazara|aceite/.test(key)) return [['craft', 'oil_mill'], ['industrial', 'oil_mill']];
  if (/granja|ganader|ovino|porcin/.test(key)) return [['landuse', 'farmyard']];
  if (/gestoria|asesoria/.test(key)) return [['office', 'accountant'], ['office', 'tax_advisor']];
  if (/taller/.test(key)) return [['shop', 'car_repair'], ['craft', 'car_repair']];
  if (/limpieza/.test(key)) return [['craft', 'cleaning'], ['office', 'company']];
  if (/distribucion/.test(key)) return [['shop', 'wholesale'], ['industrial', 'warehouse']];
  if (/cooperativa|fruta|jamon|aliment/.test(key)) return [['office', 'company'], ['industrial', 'food'], ['man_made', 'works']];
  return [['office', 'company'], ['craft', '*'], ['shop', '*'], ['industrial', '*'], ['man_made', 'works'], ['amenity', '*']];
}
const quoted = (value: string) => JSON.stringify(value);
const regexLiteral = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function overpassQuery(city: string, province: string, country: string, keywords: string[], limit: number) {
  const filters = new Set(keywords.flatMap(keyword => osmTagFilters(keyword).map(([key, value]) => value === '*' ? `[${quoted(key)}]` : `[${quoted(key)}=${quoted(value)}]`)));
  const byTags = [...filters].map(filter => `nwr(area.town)["name"]${filter};`).join('\n');
  const byName = keywords.map(keyword => `nwr(area.town)["name"~${quoted(regexLiteral(keyword))},i];`).join('\n');
  return `[out:json][timeout:55];
area["ISO3166-1"=${quoted(country)}]["admin_level"="2"]->.country;
area(area.country)["boundary"="administrative"]["admin_level"="${country === 'ES' ? 6 : 4}"]["name"~${quoted(`^${regexLiteral(province)}$`)},i]->.province;
area(area.province)["boundary"="administrative"]["admin_level"="${country === 'ES' ? 8 : 6}"]["name"~${quoted(`^${regexLiteral(city)}$`)},i]->.town;
(${byTags}\n${byName});out tags ${Math.min(200, limit)};`;
}

// Shared across adapters/profiles in this Node process, including retries.
export interface RequestGate { run<T>(request: () => Promise<T>): Promise<T> }
export class OverpassGate implements RequestGate {
  private tail: Promise<unknown> = Promise.resolve();
  private lastEnd: number | null = null;
  constructor(private readonly pause: (ms: number) => Promise<unknown> = wait, private readonly now = Date.now) {}
  run<T>(request: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(async () => {
      if (this.lastEnd !== null) await this.pause(Math.max(2000 - (this.now() - this.lastEnd), 0));
      try { return await request(); } finally { this.lastEnd = this.now(); }
    });
    this.tail = pending.catch(() => undefined); return pending;
  }
}
const sharedGate = new OverpassGate();
/** Coordinate CLI and web workers too, without holding a SQL lock while waiting. */
export class DatabaseOverpassGate implements RequestGate {
  constructor(private readonly db: PrismaClient) {}
  async run<T>(request: () => Promise<T>): Promise<T> {
    for (;;) {
      const result = await this.db.$transaction(async tx => {
        const [row] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(48105) AS locked`;
        if (!row.locked) return { ready: false as const, delay: 2000 };
        await tx.sourceThrottle.upsert({ where: { id: 'overpass' }, update: {}, create: { id: 'overpass' } });
        const [clock] = await tx.$queryRaw<{ delay: number }[]>`SELECT (EXTRACT(EPOCH FROM ("availableAt" - clock_timestamp())) * 1000)::double precision AS delay FROM "SourceThrottle" WHERE id = 'overpass'`;
        const delay = clock.delay;
        if (delay > 0) return { ready: false as const, delay };
        let value: T | undefined; let error: unknown; let failed = false;
        try { value = await request(); } catch (caught) { error = caught; failed = true; }
        await tx.$executeRaw`UPDATE "SourceThrottle" SET "availableAt" = clock_timestamp() + interval '2 seconds' WHERE id = 'overpass'`;
        return { ready: true as const, value, error, failed };
      }, { maxWait: 65_000, timeout: 70_000 });
      if (!result.ready) { await wait(Math.max(1, result.delay)); continue; }
      if (result.failed) throw result.error;
      return result.value as T;
    }
  }
}
const responseSchema = z.object({ remark: z.string().optional(), elements: z.array(z.object({ type: z.enum(['node', 'way', 'relation']), id: z.number().int(), tags: z.record(z.string()).optional() })) });
function website(value?: string) {
  try { const url = new URL(value?.includes('://') ? value : `https://${value}`); return value && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export class OpenStreetMapAdapter implements SourceAdapter {
  readonly id = 'openstreetmap' as const;
  constructor(private readonly dependencies: { fetcher?: typeof fetch; pause?: (ms: number) => Promise<unknown>; gate?: RequestGate; url?: string } = {}) {}
  async search(criteria: SearchCriteria): Promise<CandidateCompany[]> {
    const found: CandidateCompany[] = []; const ids = new Set<string>(); let queries = 0;
    for (const city of criteria.municipalities) for (const province of criteria.provinces) {
      if (found.length >= criteria.maxResults || queries++ >= 20) return found;
      const query = overpassQuery(city, province, criteria.country, criteria.keywords, criteria.maxResults - found.length);
      criteria.onQuery?.(`OSM: ${city}, ${province}; ${criteria.keywords.join(', ')}`);
      let payload: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await (this.dependencies.gate ?? sharedGate).run(async () => {
            const raw = await (this.dependencies.fetcher ?? fetch)(this.dependencies.url ?? (process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter'), {
            method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(60_000),
            headers: { 'content-type': 'application/x-www-form-urlencoded', 'User-Agent': 'try-comercial-bot (+contacto en README)', accept: 'application/json' },
            body: new URLSearchParams({ data: query }).toString(),
            });
            const data: unknown = raw.ok ? await raw.json() : null;
            if (!raw.ok) await raw.body?.cancel();
            return { ok: raw.ok, status: raw.status, data };
          });
          if (!response.ok) {
            if (![429, 504].includes(response.status) || attempt === 2) throw new SourceError(`OVERPASS_HTTP_${response.status}`);
            await (this.dependencies.pause ?? wait)(2000 * (attempt + 1)); continue;
          }
          payload = response.data; break;
        } catch (error) {
          if (error instanceof SourceError || attempt === 2) throw error instanceof SourceError ? error : new SourceError('OVERPASS_NETWORK_ERROR');
          await (this.dependencies.pause ?? wait)(2000 * (attempt + 1));
        }
      }
      const parsed = responseSchema.safeParse(payload);
      if (!parsed.success || parsed.data.remark) throw new SourceError('OVERPASS_RESPONSE_INVALID');
      for (const item of parsed.data.elements) {
        const tags = item.tags; const ref = `${item.type}/${item.id}`;
        if (!tags?.name?.trim() || ids.has(ref)) continue;
        const email = [tags.email, tags['contact:email']].flatMap(value => value?.split(/[;,]/) ?? []).map(corporateEmail).find(Boolean) ?? null;
        const candidate = candidateSchema.safeParse({ name: tags.name, city, province, country: criteria.country,
          address: [tags['addr:street'], tags['addr:housenumber'], tags['addr:postcode']].filter(Boolean).join(' ') || null,
          website: website(tags.website ?? tags['contact:website']), corporatePhone: businessPhone(tags.phone ?? tags['contact:phone']), corporateEmail: email,
          category: tags.office ?? tags.craft ?? tags.shop ?? tags.industrial ?? tags.amenity ?? tags.landuse ?? criteria.keywords[0],
          source: this.id, sourceRef: ref, sourceUrl: `https://www.openstreetmap.org/${ref}`, attribution: osmAttribution, simulated: false });
        if (candidate.success) { found.push(candidate.data); ids.add(ref); }
        if (found.length === criteria.maxResults) break;
      }
    }
    return found;
  }
}
