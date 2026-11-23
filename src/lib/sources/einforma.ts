import { z } from 'zod';
import { SourceError } from './google-places';
import { normalizeText } from '../normalization';
import { candidateSchema, type CandidateCompany, type SearchCriteria, type SourceAdapter } from './types';

/** La búsqueda de eInforma no devuelve municipio (solo provincia): se marca así y se completa después. */
export const CITY_PENDING = 'Por verificar';
const BASE_URL = 'https://developers.einforma.com/api/v1';
const PAGE_SIZE = 50;

/** Entidades que no sirven para prospección: extinguidas, en liquidación o comunidades de propietarios. */
export function einformaDescartable(name: string) {
  const value = normalizeText(name);
  return /\b(extinguida|extinguido|en liquidacion|disuelta|en concurso)\b/.test(value)
    || /\bcoop(erativa)? de viviendas?\b/.test(value)
    || /\b(cdad|comunidad) (de )?prop(ietarios)?\b/.test(value) || /^c\.? ?p\.? /.test(value) || /\bcomunidad de bienes\b/.test(value) && /\bprop/.test(value);
}

const tokenSchema = z.object({ access_token: z.string().min(10), expires_in: z.coerce.number().default(3600) });
const companySchema = z.object({ id: z.string().min(1), denominacion: z.string().min(2), provincia: z.string().optional() });
const searchSchema = z.object({ total: z.coerce.number().default(0), empresa: z.union([z.array(z.unknown()), z.unknown()]).optional() });

export type EinformaCredentials = { clientId: string; clientSecret: string };
type Dependencies = { fetcher?: typeof fetch; baseUrl?: string; maxPages?: number; now?: () => number };

export function einformaCredentials(env: Record<string, string | undefined> = process.env): EinformaCredentials | null {
  const clientId = env.EINFORMA_CLIENT_ID?.trim(); const clientSecret = env.EINFORMA_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * Fuente eInforma (empresas españolas). Usa solo el buscador, que no consume saldo:
 * busca cada palabra clave en la denominación y se queda con las empresas de las provincias del perfil.
 * Las fichas (municipio, teléfono, web, CNAE…) consumen saldo y no se piden.
 */
export class EinformaAdapter implements SourceAdapter {
  readonly id = 'einforma' as const;
  private token: { value: string; expiresAt: number } | null = null;
  constructor(private readonly credentials: EinformaCredentials, private readonly dependencies: Dependencies = {}) {}

  private get base() { return this.dependencies.baseUrl ?? BASE_URL; }
  private now() { return (this.dependencies.now ?? Date.now)(); }

  private async accessToken(force = false) {
    if (!force && this.token && this.token.expiresAt > this.now()) return this.token.value;
    let response: Response;
    try {
      response = await (this.dependencies.fetcher ?? fetch)(`${this.base}/oauth/token`, {
        method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(20_000),
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ client_id: this.credentials.clientId, client_secret: this.credentials.clientSecret, grant_type: 'client_credentials', scope: 'buscar:consultar:empresas' }).toString(),
      });
    } catch { throw new SourceError('EINFORMA_NETWORK_ERROR'); }
    if (!response.ok) { await response.body?.cancel(); throw new SourceError(`EINFORMA_TOKEN_HTTP_${response.status}`); }
    const parsed = tokenSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new SourceError('EINFORMA_TOKEN_INVALID');
    // Se reutiliza hasta un minuto antes de caducar, como pide eInforma.
    this.token = { value: parsed.data.access_token, expiresAt: this.now() + Math.max(60, parsed.data.expires_in - 60) * 1000 };
    return this.token.value;
  }

  private async get(path: string): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response;
      try {
        response = await (this.dependencies.fetcher ?? fetch)(`${this.base}${path}`, {
          cache: 'no-store', signal: AbortSignal.timeout(25_000),
          headers: { authorization: `Bearer ${await this.accessToken(attempt > 0)}`, accept: 'application/json' },
        });
      } catch (error) { if (error instanceof SourceError) throw error; throw new SourceError('EINFORMA_NETWORK_ERROR'); }
      if (response.status === 401 && attempt === 0) { await response.body?.cancel(); continue; }
      if (!response.ok) { await response.body?.cancel(); throw new SourceError(`EINFORMA_HTTP_${response.status}`); }
      return response.json().catch(() => { throw new SourceError('EINFORMA_RESPONSE_INVALID'); });
    }
    throw new SourceError('EINFORMA_HTTP_401');
  }

  async search(criteria: SearchCriteria): Promise<CandidateCompany[]> {
    if (criteria.country !== 'ES') throw new SourceError('EINFORMA_ONLY_SPAIN');
    const provinces = criteria.provinces.map(normalizeText);
    const inProfile = (province?: string) => {
      const value = normalizeText(province ?? '');
      return Boolean(value) && provinces.some(wanted => value === wanted || value.split(/[/ ]+/).includes(wanted) || wanted.split(/[/ ]+/).includes(value));
    };
    const maxPages = Math.max(1, Math.min(20, this.dependencies.maxPages ?? Number(process.env.EINFORMA_MAX_PAGES || 10)));
    const found: CandidateCompany[] = []; const seen = new Set<string>();
    for (const keyword of criteria.keywords) {
      if (found.length >= criteria.maxResults) break;
      criteria.onQuery?.(`eInforma: «${keyword}» en ${criteria.provinces.join(', ')}`);
      for (let page = 0; page < maxPages && found.length < criteria.maxResults; page++) {
        const parsed = searchSchema.safeParse(await this.get(`/companies?${new URLSearchParams({ companySearch: keyword, rows: String(PAGE_SIZE), start: String(page * PAGE_SIZE) })}`));
        if (!parsed.success) throw new SourceError('EINFORMA_RESPONSE_INVALID');
        const rows = parsed.data.empresa === undefined ? [] : Array.isArray(parsed.data.empresa) ? parsed.data.empresa : [parsed.data.empresa];
        for (const raw of rows) {
          const company = companySchema.safeParse(raw);
          if (!company.success || seen.has(company.data.id) || !inProfile(company.data.provincia) || einformaDescartable(company.data.denominacion)) continue;
          const candidate = candidateSchema.safeParse({
            name: company.data.denominacion, city: CITY_PENDING, province: company.data.provincia, country: 'ES',
            address: null, website: null, corporatePhone: null, category: keyword,
            source: this.id, sourceRef: company.data.id, sourceUrl: null, simulated: false,
          });
          if (candidate.success) { found.push(candidate.data); seen.add(company.data.id); }
          if (found.length >= criteria.maxResults) break;
        }
        if ((page + 1) * PAGE_SIZE >= parsed.data.total || !rows.length) break;
      }
    }
    return found;
  }
}
