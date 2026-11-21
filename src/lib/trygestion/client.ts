import { z } from 'zod';
import { normalizeDomain, normalizeText } from '../normalization';
import { normalizedBusinessName, normalizedNif } from '../prospecting/deduplication';

export class TrygestionError extends Error {
  constructor(public readonly code: string, public readonly status = 0, public readonly details?: Record<string, unknown>) { super(code); this.name = 'TrygestionError'; }
}
export function trygestionConfiguration(env: Record<string, string | undefined> = process.env) {
  const url = env.TRYGESTION_URL?.trim(); const token = env.TRYGESTION_TOKEN?.trim();
  if (!url || !token) return { enabled: false as const, url: '', token: '' };
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error();
    return { enabled: true as const, url: url.replace(/\/+$/, ''), token };
  } catch { throw new TrygestionError('INVALID_CONFIGURATION'); }
}
const id = z.union([z.string().min(1), z.number()]).transform(String);
export const empresaSchema = z.object({ id, nombre: z.string(), cif: z.string().nullish(), web: z.string().nullish(), notas: z.string().nullish() }).passthrough();
const linkedSchema = z.object({ id }).passthrough();
export const etapaSchema = z.object({ id, nombre: z.string() }).passthrough();
const opportunitySchema = linkedSchema.extend({ titulo: z.string(), descripcion: z.string().nullish(), empresa_id: id });
const contactSchema = linkedSchema.extend({ empresa_id: id, nombre: z.string(), email: z.string().nullish(), telefono: z.string().nullish() });
const acknowledgement = z.object({ id: id.optional(), success: z.boolean().optional(), ok: z.boolean().optional(), messageId: z.string().optional() }).passthrough();
function unwrap(body: unknown, key?: string): unknown {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const object = body as Record<string, unknown>;
    if (object.data !== undefined) return object.data;
    if (key && object[key] !== undefined) return object[key];
  }
  return body;
}
export type EmpresaInput = { nombre: string; cif?: string | null; web?: string | null; ciudad?: string | null; provincia?: string | null; pais?: string; telefono?: string | null; email?: string | null; sector?: string | null; notas?: string };
export type ContactoInput = { empresa_id: string; nombre: string; cargo?: string | null; telefono?: string | null; email?: string | null };
export type OportunidadInput = { titulo: string; descripcion?: string; empresa_id: string; contacto_id?: string | null; etapa_id: string; probabilidad: number };
export type ActividadInput = { tipo: 'llamada' | 'email' | 'reunion' | 'nota'; titulo: string; descripcion: string; fecha_programada?: string | null };
export type EventoInput = { titulo: string; descripcion: string; fecha_inicio: string; fecha_fin: string; hora: string; tipo: string; ambito: 'externo'; ubicacion: string; entidad_externa: string };
export type EmailInput = { to: string; subject: string; html: string; text: string; approvedBy: string; firmante?: string; cargo?: string; externalRef: string; oportunidadId?: string; unsubscribeUrl: string };

export class TrygestionClient {
  readonly configuration: ReturnType<typeof trygestionConfiguration>;
  constructor(private readonly options: { env?: Record<string, string | undefined>; fetcher?: typeof fetch } = {}) { this.configuration = trygestionConfiguration(options.env); }
  get enabled() { return this.configuration.enabled; }
  private async request<S extends z.ZodTypeAny>(path: string, schema: S, method = 'GET', data?: unknown, key?: string, idempotencyKey?: string): Promise<z.output<S>> {
    if (!this.enabled) throw new TrygestionError('DISABLED');
    let response: Response;
    try {
      response = await (this.options.fetcher ?? fetch)(`${this.configuration.url}${path}`, { method, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${this.configuration.token}`, Accept: 'application/json', ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
    } catch { throw new TrygestionError('NETWORK_OR_TIMEOUT'); }
    if (!response.ok) {
      let details: Record<string, unknown> | undefined;
      try { const text = (await response.text()).slice(0, 4000); const parsed: unknown = JSON.parse(text); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) details = parsed as Record<string, unknown>; } catch { details = undefined; }
      throw new TrygestionError(response.status === 401 ? 'UNAUTHORIZED' : `HTTP_${response.status}`, response.status, details);
    }
    try {
      const body: unknown = response.status === 204 ? { ok: true } : await response.json();
      return schema.parse(unwrap(body, key));
    } catch { throw new TrygestionError('INVALID_RESPONSE', response.status); }
  }
  estado() { return this.request('/comercial/estado', z.object({ tenant: z.union([z.string(), z.number(), z.record(z.unknown())]), smtp: z.boolean(), ia: z.boolean(), googleCalendar: z.boolean(), etapas: z.array(etapaSchema) })); }
  private empresasCache: z.infer<typeof empresaSchema>[] | null = null;
  /** trygestión only filters `search` by name, so the tenant list is read once per client and matched locally. */
  async listarEmpresas() {
    this.empresasCache ??= await this.request('/empresas', z.array(empresaSchema), 'GET', undefined, 'empresas');
    return this.empresasCache;
  }
  async buscarEmpresa(input: { cif?: string | null; web?: string | null; nombre: string }) {
    const rows = await this.listarEmpresas();
    const find = (predicate: (row: z.infer<typeof empresaSchema>) => boolean) => {
      const matches = rows.filter(predicate); if (matches.length > 1) throw new TrygestionError('AMBIGUOUS_COMPANY_MATCH'); return matches[0];
    };
    const nif = normalizedNif(input.cif); const domain = normalizeDomain(input.web); const name = normalizedBusinessName(input.nombre);
    return (nif ? find(row => normalizedNif(row.cif) === nif) : undefined)
      ?? (domain ? find(row => normalizeDomain(row.web) === domain) : undefined)
      ?? (name ? find(row => normalizedBusinessName(row.nombre) === name) : undefined)
      ?? null;
  }
  empresa(id: string) { return this.request(`/empresas/${encodeURIComponent(id)}`, empresaSchema); }
  async crearEmpresa(data: EmpresaInput, key?: string) {
    try {
      const created = await this.request('/empresas', linkedSchema, 'POST', data, undefined, key);
      this.empresasCache = null; return created;
    } catch (error) {
      // trygestión rejects a repeated CIF and returns the existing company: link to it instead of failing.
      const existing = error instanceof TrygestionError && error.status === 400 && error.details?.code === 'DUPLICATE_CIF' ? error.details.empresaExistenteId : undefined;
      if (typeof existing === 'string' || typeof existing === 'number') return { id: String(existing), linkedExisting: true };
      throw error;
    }
  }
  /** PUT /empresas/:id overwrites every column, so the full current row is always sent back with the changes. */
  actualizarEmpresa(current: z.infer<typeof empresaSchema>, changes: Partial<EmpresaInput>, key?: string) {
    const pick = (field: string) => (current as Record<string, unknown>)[field] ?? null;
    const body = { nombre: current.nombre, cif: pick('cif'), direccion: pick('direccion'), ciudad: pick('ciudad'), telefono: pick('telefono'), email: pick('email') || null, web: pick('web') || null, sector: pick('sector'), notas: pick('notas'), ...changes };
    this.empresasCache = null;
    return this.request(`/empresas/${encodeURIComponent(current.id)}`, acknowledgement, 'PUT', body, undefined, key);
  }
  async buscarContacto(data: ContactoInput) {
    const rows = await this.request(`/contactos?empresa_id=${encodeURIComponent(data.empresa_id)}`, z.array(contactSchema), 'GET', undefined, 'contactos');
    return rows.find(row => row.empresa_id === data.empresa_id && (data.email ? row.email?.toLowerCase() === data.email.toLowerCase() : normalizeText(row.nombre) === normalizeText(data.nombre) && (row.telefono ?? '') === (data.telefono ?? ''))) ?? null;
  }
  crearContacto(data: ContactoInput, key?: string) { return this.request('/contactos', linkedSchema, 'POST', data, undefined, key); }
  etapas() { return this.request('/pipeline/etapas', z.array(etapaSchema), 'GET', undefined, 'etapas'); }
  /** Finds the opportunity created by try! Comercial for a company by its reference (in the description) or legacy title. */
  async buscarOportunidad(empresaId: string, referencia: string, tituloAntiguo?: string) {
    const rows = await this.request(`/pipeline/oportunidades?empresa_id=${encodeURIComponent(empresaId)}`, z.array(opportunitySchema), 'GET', undefined, 'oportunidades');
    return rows.find(row => row.empresa_id === empresaId && ((row.descripcion ?? '').includes(referencia) || (tituloAntiguo !== undefined && row.titulo === tituloAntiguo))) ?? null;
  }
  crearOportunidad(data: OportunidadInput, key?: string) { return this.request('/pipeline/oportunidades', linkedSchema, 'POST', data, undefined, key); }
  oportunidad(id: string) { return this.request(`/pipeline/oportunidades/${encodeURIComponent(id)}`, opportunitySchema); }
  /** PUT /pipeline/oportunidades/:id nulls the fields it is not sent (empresa, contacto, responsable…), so the current row is merged. */
  async actualizarOportunidad(id: string, probabilidad: number, key?: string, descripcion?: string) {
    const current = await this.oportunidad(id) as Record<string, unknown>;
    const keep = ['titulo', 'descripcion', 'empresa_id', 'contacto_id', 'etapa_id', 'valor_estimado', 'fecha_cierre_estimada', 'responsable_id', 'cotizacion_id', 'proyecto_id', 'categoria'];
    const body = Object.fromEntries(keep.map(field => [field, current[field] ?? null]));
    // The description is only replaced while it is still the one try! Comercial wrote (it contains our reference).
    const ours = typeof current.descripcion === 'string' && current.descripcion.startsWith('Oportunidad creada desde try! Comercial');
    return this.request(`/pipeline/oportunidades/${encodeURIComponent(id)}`, acknowledgement, 'PUT', { ...body, probabilidad, ...(descripcion && (ours || !current.descripcion) ? { descripcion } : {}) }, undefined, key);
  }
  cambiarEtapa(id: string, etapa_id: string, key?: string) { return this.request(`/pipeline/oportunidades/${encodeURIComponent(id)}/etapa`, acknowledgement, 'PUT', { etapa_id }, undefined, key); }
  cambiarEstado(id: string, estado: 'ganada' | 'perdida', motivo?: string, key?: string) { return this.request(`/pipeline/oportunidades/${encodeURIComponent(id)}/estado`, acknowledgement, 'PUT', { estado, ...(estado === 'perdida' && motivo ? { motivo_perdida: motivo } : {}) }, undefined, key); }
  crearActividad(id: string, data: ActividadInput, key?: string) { return this.request(`/pipeline/oportunidades/${encodeURIComponent(id)}/actividades`, linkedSchema, 'POST', data, undefined, key); }
  crearEvento(data: EventoInput, key?: string) { return this.request('/eventos', linkedSchema, 'POST', data, undefined, key); }
  enviarEmail(data: EmailInput) { return this.request('/comercial/email/enviar', acknowledgement, 'POST', data, undefined, data.externalRef); }
  generarIA(data: { system: string; prompt: string; schema: Record<string, unknown>; maxTokens: number }) { return this.request('/comercial/ia/generar', z.object({ json: z.unknown(), model: z.string(), usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional(), prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() }).optional() }), 'POST', data); }
  suprimir(data: { email?: string; dominio?: string; motivo: string }, key?: string) { return this.request('/comercial/supresion', acknowledgement, 'POST', data, undefined, key); }
}
