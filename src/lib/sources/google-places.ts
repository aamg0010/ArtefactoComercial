import { z } from 'zod';
import { setTimeout as wait } from 'node:timers/promises';
import { candidateSchema, searchQueries, type CandidateCompany, type SearchCriteria, type SourceAdapter } from './types';
import { normalizeText } from '../normalization';

export const placesFieldMask = 'places.id,places.displayName,places.addressComponents,places.formattedAddress,places.websiteUri,places.internationalPhoneNumber,places.primaryType,places.attributions,nextPageToken';
const placeSchema = z.object({
  id: z.string(), displayName: z.object({ text: z.string() }),
  // Google omite a veces `types` (o el texto) en partes de la dirección, p. ej. «S N, Carretera…».
  addressComponents: z.array(z.object({ longText: z.string().default(''), shortText: z.string().optional(), types: z.array(z.string()).default([]) })).optional(),
  formattedAddress: z.string().optional(), websiteUri: z.string().optional(), internationalPhoneNumber: z.string().optional(), primaryType: z.string().optional(),
  attributions: z.array(z.object({ provider: z.string().optional(), providerUri: z.string().optional() })).optional(),
});
// Cada lugar se valida por separado: uno mal formado se descarta sin perder el resto de la búsqueda.
const responseSchema = z.object({ places: z.array(z.unknown()).default([]), nextPageToken: z.string().optional() });
type Dependencies = { fetcher?: typeof fetch; pause?: (ms: number) => Promise<unknown>; maxPages?: number; maxQueries?: number };
export class SourceError extends Error { constructor(public readonly code: string) { super(code); } }

export class GooglePlacesAdapter implements SourceAdapter {
  readonly id = 'google-places' as const;
  constructor(private readonly key: string, private readonly dependencies: Dependencies = {}) {}

  private async request(url: string, body?: object, options: { fieldMask?: string; timeoutMs?: number; signal?: AbortSignal; attempts?: number } = {}) {
    for (let attempt = 0; attempt < (options.attempts ?? 3); attempt++) {
      try {
        const response = await (this.dependencies.fetcher ?? fetch)(url, {
          method: body ? 'POST' : 'GET', cache: 'no-store', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 15_000)]) : AbortSignal.timeout(options.timeoutMs ?? 15_000),
          headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': this.key,
            'X-Goog-FieldMask': options.fieldMask ?? (body ? placesFieldMask : placesFieldMask.split(',').filter(field => field !== 'nextPageToken').map(field => field.replace(/^places\./, '')).join(',')) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (!response.ok) {
          await response.body?.cancel();
          const error = new SourceError(`GOOGLE_HTTP_${response.status}`);
          if (response.status !== 429 && response.status < 500) throw error;
          if (attempt === (options.attempts ?? 3) - 1) throw error;
        } else return await response.json() as unknown;
      } catch (error) {
        if (error instanceof SourceError) {
          if (!/^GOOGLE_HTTP_(429|5\d\d)$/.test(error.code) || attempt === (options.attempts ?? 3) - 1) throw error;
        } else if (attempt === (options.attempts ?? 3) - 1) throw new SourceError('GOOGLE_NETWORK_ERROR');
      }
      await (this.dependencies.pause ?? wait)(1000 * (attempt + 1));
    }
    throw new SourceError('GOOGLE_REQUEST_FAILED');
  }

  private candidate(place: z.infer<typeof placeSchema>, fallback: { city: string; province: string }, country: 'ES' | 'CO'): CandidateCompany | null {
    const component = (type: string) => place.addressComponents?.find(item => item.types.includes(type));
    const detectedCountry = component('country')?.shortText;
    if (detectedCountry !== country) return null;
    const parsed = candidateSchema.safeParse({
      name: place.displayName.text, city: component('locality')?.longText ?? component('postal_town')?.longText ?? component('administrative_area_level_3')?.longText ?? fallback.city,
      province: component(country === 'CO' ? 'administrative_area_level_1' : 'administrative_area_level_2')?.longText ?? fallback.province, country,
      address: place.formattedAddress ?? null, website: place.websiteUri ?? null, corporatePhone: place.internationalPhoneNumber ?? null,
      category: place.primaryType ?? '', source: this.id, sourceRef: place.id,
      sourceUrl: `https://www.google.com/maps/search/?api=1&query=place&query_place_id=${encodeURIComponent(place.id)}`,
      attributions: place.attributions?.filter(item => item.provider && item.providerUri).map(item => ({ displayName: item.provider, uri: item.providerUri })),
    });
    return parsed.success ? parsed.data : null;
  }

  async search(criteria: SearchCriteria) {
    const candidates: CandidateCompany[] = []; const seen = new Set<string>();
    const maxPages = this.dependencies.maxPages ?? Number(process.env.GOOGLE_PLACES_MAX_PAGES || 3);
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10) throw new SourceError('GOOGLE_PAGE_LIMIT_INVALID');
    const maxQueries = Math.max(1, Math.min(100, this.dependencies.maxQueries ?? 20));
    let queries = 0;
    for (const query of searchQueries(criteria)) {
      if (queries++ >= maxQueries || candidates.length >= criteria.maxResults) break;
      criteria.onQuery?.(query.text);
      let pageToken: string | undefined; const tokens = new Set<string>();
      for (let page = 0; page < maxPages; page++) {
        const parsed = responseSchema.safeParse(await this.request('https://places.googleapis.com/v1/places:searchText', {
          textQuery: query.text, languageCode: 'es', regionCode: criteria.country,
          pageSize: Math.min(20, criteria.maxResults - candidates.length), ...(pageToken ? { pageToken } : {}),
        }));
        if (!parsed.success) throw new SourceError('GOOGLE_RESPONSE_INVALID');
        for (const raw of parsed.data.places) {
          const valid = placeSchema.safeParse(raw);
          if (!valid.success) continue;
          const place = valid.data;
          if (seen.has(place.id)) continue;
          const candidate = this.candidate(place, query, criteria.country);
          if (candidate && criteria.municipalities.some(city => normalizeText(city) === normalizeText(candidate.city)) && criteria.provinces.some(province => normalizeText(province) === normalizeText(candidate.province))) { candidates.push(candidate); seen.add(place.id); }
          if (candidates.length === criteria.maxResults) break;
        }
        pageToken = parsed.data.nextPageToken;
        if (!pageToken || tokens.has(pageToken) || candidates.length >= criteria.maxResults) break;
        tokens.add(pageToken);
      }
    }
    return candidates;
  }

  async displayName(placeId: string, signal?: AbortSignal): Promise<string> {
    const parsed = z.object({ id: z.string(), displayName: z.object({ text: z.string().trim().min(1) }) }).safeParse(
      await this.request(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, undefined,
        { fieldMask: 'id,displayName', timeoutMs: 5_000, attempts: 1, signal }));
    if (!parsed.success) throw new SourceError('GOOGLE_RESPONSE_INVALID');
    return parsed.data.displayName.text;
  }

  async details(placeId: string, country: 'ES' | 'CO') {
    const parsed = placeSchema.safeParse(await this.request(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`));
    if (!parsed.success) throw new SourceError('GOOGLE_RESPONSE_INVALID');
    return this.candidate(parsed.data, { city: 'Pendiente', province: '' }, country);
  }
}
