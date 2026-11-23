import { z } from 'zod';
import { SourceError } from './google-places';
import { CITY_PENDING } from './einforma';
import { normalizeText } from '../normalization';
import { candidateSchema, type CandidateCompany, type SearchCriteria, type SourceAdapter } from './types';

/** Datos abiertos del RUES (Confecámaras) en datos.gov.co: personas jurídicas y ESAL de todas las cámaras de comercio. */
const DATASET_URL = 'https://www.datos.gov.co/resource/c82u-588k.json';
const PAGE_SIZE = 200;

/** Cámaras de comercio por departamento (el RUES abierto no trae municipio, solo la cámara). */
export const RUES_CHAMBERS: Record<string, string[]> = {
  'amazonas': ['AMAZONAS'],
  'antioquia': ['MEDELLIN PARA ANTIOQUIA', 'ABURRA SUR', 'ORIENTE ANTIOQUENO', 'URABA', 'MAGDALENA MEDIO'],
  'arauca': ['ARAUCA', 'PIEDEMONTE ARAUCANO'],
  'atlantico': ['BARRANQUILLA'],
  'bogota': ['BOGOTA'],
  'bolivar': ['CARTAGENA', 'MAGANGUE'],
  'boyaca': ['TUNJA', 'DUITAMA', 'SOGAMOSO'],
  'caldas': ['MANIZALES', 'CHINCHINA', 'LA DORADA'],
  'caqueta': ['FLORENCIA PARA EL CAQUETA'],
  'casanare': ['CASANARE'],
  'cauca': ['CAUCA'],
  'cesar': ['VALLEDUPAR', 'AGUACHICA'],
  'choco': ['CHOCÓ'],
  'cordoba': ['MONTERIA'],
  'cundinamarca': ['BOGOTA', 'FACATATIVA', 'GIRARDOT', 'SOACHA'],
  'guaviare': ['SAN JOSE'],
  'huila': ['HUILA'],
  'la guajira': ['LA GUAJIRA'],
  'magdalena': ['SANTA MARTA PARA EL MAGDALENA'],
  'meta': ['VILLAVICENCIO'],
  'narino': ['PASTO', 'IPIALES', 'TUMACO'],
  'norte de santander': ['CUCUTA', 'PAMPLONA', 'OCANA'],
  'putumayo': ['PUTUMAYO'],
  'quindio': ['ARMENIA'],
  'risaralda': ['PEREIRA', 'DOSQUEBRADAS', 'SANTA ROSA DE CABAL'],
  'san andres': ['SAN ANDRES'],
  'santander': ['BUCARAMANGA', 'BARRANCABERMEJA'],
  'sucre': ['SINCELEJO'],
  'tolima': ['IBAGUE', 'HONDA', 'SUR Y ORIENTE DEL TOLIMA'],
  'valle del cauca': ['CALI', 'PALMIRA', 'BUGA', 'TULUA', 'CARTAGO', 'BUENAVENTURA', 'SEVILLA'],
};
const ALIASES: Record<string, string> = { 'bogota dc': 'bogota', 'bogota d c': 'bogota', 'valle': 'valle del cauca', 'guajira': 'la guajira', 'san andres y providencia': 'san andres', 'norte santander': 'norte de santander' };
const departmentOf = (chamber: string) => Object.keys(RUES_CHAMBERS).find(key => RUES_CHAMBERS[key].includes(chamber));
const titleCase = (value: string) => value.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, space: string, letter: string) => space + letter.toUpperCase()).replace(/ (Para|Del|De|El|Y) /g, word => word.toLowerCase());

/** Traduce departamentos (o ciudades sede de cámara, p. ej. «Montería») del perfil a cámaras de comercio. */
export function ruesChambers(criteria: Pick<SearchCriteria, 'provinces' | 'municipalities'>) {
  const chambers = new Map<string, string>(); // cámara -> departamento tal como lo escribió el usuario
  const all = Object.values(RUES_CHAMBERS).flat();
  for (const raw of criteria.provinces) {
    const key = normalizeText(raw).replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
    for (const chamber of RUES_CHAMBERS[ALIASES[key] ?? key] ?? []) chambers.set(chamber, raw.trim());
  }
  for (const raw of [...criteria.provinces, ...criteria.municipalities]) {
    const value = normalizeText(raw);
    for (const chamber of all) if (normalizeText(chamber).split(' para ')[0] === value && !chambers.has(chamber)) chambers.set(chamber, titleCase(departmentOf(chamber) ?? raw));
  }
  return chambers;
}

const rowSchema = z.object({
  codigo_camara: z.string(), camara_comercio: z.string(), matricula: z.string().min(1), razon_social: z.string().min(2),
  nit: z.string().optional(), numero_identificacion: z.string().optional(), digito_verificacion: z.string().optional(),
  cod_ciiu_act_econ_pri: z.string().optional(), ultimo_ano_renovado: z.string().optional(),
});
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
/** Palabra clave tal como aparece en el RUES: mayúsculas y sin tildes (la Ñ se mantiene). */
const asRegistered = (keyword: string) => keyword.normalize('NFD').replace(/(?!̃)[̀-ͯ]/g, '').normalize('NFC').toUpperCase().trim();

type Dependencies = { fetcher?: typeof fetch; knownRefs?: () => Promise<Set<string>>; maxPages?: number; now?: () => Date };

/**
 * Fuente RUES (Colombia). Datos abiertos y gratuitos: solo sociedades y ESAL activas que renovaron
 * el año pasado o este, en las cámaras de los departamentos del perfil, cuyo CIIU principal empieza por
 * alguno de los códigos del perfil o cuya razón social contiene alguna palabra clave.
 * No se guardan personas naturales ni datos del representante legal.
 */
export class RuesAdapter implements SourceAdapter {
  readonly id = 'rues' as const;
  constructor(private readonly dependencies: Dependencies = {}) {}

  private async page(where: string, offset: number) {
    const params = new URLSearchParams({
      $select: 'codigo_camara,camara_comercio,matricula,razon_social,nit,numero_identificacion,digito_verificacion,cod_ciiu_act_econ_pri,ultimo_ano_renovado',
      $where: where, $order: 'ultimo_ano_renovado DESC, fecha_renovacion DESC, matricula', $limit: String(PAGE_SIZE), $offset: String(offset),
    });
    const token = process.env.SOCRATA_APP_TOKEN?.trim();
    let response: Response;
    try {
      response = await (this.dependencies.fetcher ?? fetch)(`${DATASET_URL}?${params}`, {
        cache: 'no-store', signal: AbortSignal.timeout(60_000), headers: { accept: 'application/json', ...(token ? { 'x-app-token': token } : {}) },
      });
    } catch { throw new SourceError('RUES_NETWORK_ERROR'); }
    if (!response.ok) { await response.body?.cancel(); throw new SourceError(`RUES_HTTP_${response.status}`); }
    const body = await response.json().catch(() => null);
    if (!Array.isArray(body)) throw new SourceError('RUES_RESPONSE_INVALID');
    return body;
  }

  async search(criteria: SearchCriteria): Promise<CandidateCompany[]> {
    if (criteria.country !== 'CO') throw new SourceError('RUES_ONLY_COLOMBIA');
    const chambers = ruesChambers(criteria);
    if (!chambers.size) throw new SourceError('RUES_NO_CHAMBER');
    const codes = [...new Set(criteria.cnaeCodes.map(code => code.trim()).filter(code => /^\d{2,4}$/.test(code)))];
    const keywords = [...new Set(criteria.keywords.map(asRegistered).filter(word => word.length >= 3))];
    if (!codes.length && !keywords.length) return [];
    const since = String((this.dependencies.now?.() ?? new Date()).getFullYear() - 1);
    const match = [...codes.map(code => `starts_with(cod_ciiu_act_econ_pri, ${quote(code)})`), ...keywords.map(word => `upper(razon_social) like ${quote(`%${word}%`)}`)];
    const where = [
      `camara_comercio in (${[...chambers.keys()].map(quote).join(', ')})`, `estado_matricula = 'ACTIVA'`,
      `organizacion_juridica != 'PERSONA NATURAL'`, `starts_with(categoria_matricula, 'SOCIEDAD')`, `ultimo_ano_renovado >= ${quote(since)}`,
      `(${match.join(' OR ')})`,
    ].join(' AND ');
    criteria.onQuery?.(`RUES: ${[...codes.map(code => `CIIU ${code}`), ...keywords.map(word => `«${word.toLowerCase()}»`)].join(', ')} en ${[...new Set(chambers.values())].join(', ')}`);

    // Se saltan las empresas que ya trajo el RUES en búsquedas anteriores, para que cada ejecución aporte nuevas.
    const known = this.dependencies.knownRefs ? await this.dependencies.knownRefs() : new Set<string>();
    const maxPages = Math.max(1, Math.min(10, this.dependencies.maxPages ?? 5));
    const found: CandidateCompany[] = [];
    for (let page = 0; page < maxPages && found.length < criteria.maxResults; page++) {
      const rows = await this.page(where, page * PAGE_SIZE);
      for (const raw of rows) {
        const row = rowSchema.safeParse(raw);
        if (!row.success) continue;
        const ref = `${row.data.codigo_camara}-${row.data.matricula}`;
        if (known.has(ref)) continue;
        const name = row.data.razon_social.trim();
        const ciiu = row.data.cod_ciiu_act_econ_pri ?? '';
        const category = keywords.find(word => name.toUpperCase().includes(word))?.toLowerCase() ?? (ciiu ? `CIIU ${ciiu}` : codes[0] ?? '');
        const nit = row.data.nit || row.data.numero_identificacion;
        const candidate = candidateSchema.safeParse({
          name, city: CITY_PENDING, province: chambers.get(row.data.camara_comercio) ?? titleCase(departmentOf(row.data.camara_comercio) ?? ''), country: 'CO',
          address: null, website: null, corporatePhone: null, category,
          nif: nit ? `${nit}${row.data.digito_verificacion ? `-${row.data.digito_verificacion}` : ''}` : null,
          source: this.id, sourceRef: ref, sourceUrl: null, simulated: false,
          attribution: `RUES · Cámara de Comercio de ${titleCase(row.data.camara_comercio.toLowerCase())}`,
        });
        if (candidate.success) { found.push(candidate.data); known.add(ref); }
        if (found.length >= criteria.maxResults) break;
      }
      if (rows.length < PAGE_SIZE) break;
    }
    return found;
  }
}
