import { z } from 'zod';

/**
 * Acceso con el usuario de trygestión (cada persona con sus credenciales).
 * El servidor de try! Comercial comprueba email y contraseña contra POST /api/auth/login de trygestión,
 * exige pertenecer al tenant configurado (TRY) y cierra enseguida la sesión que abre en trygestión.
 * La contraseña no se guarda en ningún sitio.
 */
type Environment = Record<string, string | undefined>;

export type TrygestionLoginResult =
  | { ok: true; email: string; name: string; role: 'ADMIN' | 'SALES'; trygestionUserId: string; tenant: string }
  | { ok: false; reason: 'INVALID_CREDENTIALS' | 'NOT_IN_TENANT' | 'NOT_CONFIGURED' | 'UNAVAILABLE' };

const loginResponse = z.object({
  token: z.string().min(10),
  usuario: z.object({ id: z.union([z.string(), z.number()]).transform(String), nombre: z.string().nullish(), email: z.string().email(), rol: z.string().nullish(), rol_efectivo: z.string().nullish(), es_superadmin: z.union([z.number(), z.boolean()]).nullish() }).passthrough(),
  tenants: z.array(z.object({ id: z.string(), nombre: z.string().nullish(), rol_tenant: z.string().nullish() }).passthrough()).default([]),
}).passthrough();

export function authMode(env: Environment = process.env): 'trygestion' | 'local' {
  return env.AUTH_MODE === 'trygestion' ? 'trygestion' : 'local';
}
export function trygestionTenantId(env: Environment = process.env) {
  return env.TRYGESTION_TENANT_ID?.trim() || 'tenant-try-legacy';
}

/** CEO (rol global o efectivo) o CEO/propietario del tenant → administración; el resto, comercial. */
export function roleFor(usuario: { rol?: string | null; rol_efectivo?: string | null }, tenantRole?: string | null): 'ADMIN' | 'SALES' {
  const roles = [usuario.rol_efectivo, usuario.rol, tenantRole].map(value => (value ?? '').toLowerCase());
  return roles.some(value => ['ceo', 'propietario', 'owner'].includes(value)) ? 'ADMIN' : 'SALES';
}

export async function loginConTrygestion(email: string, password: string, options: { env?: Environment; fetcher?: typeof fetch } = {}): Promise<TrygestionLoginResult> {
  const env = options.env ?? process.env;
  const base = env.TRYGESTION_URL?.trim().replace(/\/+$/, '');
  if (!base) return { ok: false, reason: 'NOT_CONFIGURED' };
  const fetcher = options.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(`${base}/auth/login`, { method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email, password }) });
  } catch { return { ok: false, reason: 'UNAVAILABLE' }; }
  if (response.status === 401 || response.status === 400 || response.status === 403) { await response.body?.cancel(); return { ok: false, reason: 'INVALID_CREDENTIALS' }; }
  if (!response.ok) { await response.body?.cancel(); return { ok: false, reason: 'UNAVAILABLE' }; }
  let data: z.infer<typeof loginResponse>;
  try { data = loginResponse.parse(await response.json()); } catch { return { ok: false, reason: 'UNAVAILABLE' }; }

  // La sesión de trygestión solo sirve para comprobar la identidad: se cierra enseguida.
  fetcher(`${base}/auth/logout`, { method: 'POST', cache: 'no-store', headers: { Authorization: `Bearer ${data.token}` }, signal: AbortSignal.timeout(10_000) }).then(r => r.body?.cancel()).catch(() => {});

  const tenant = data.tenants.find(item => item.id === trygestionTenantId(env));
  if (!tenant) return { ok: false, reason: 'NOT_IN_TENANT' };
  return { ok: true, email: data.usuario.email.toLowerCase(), name: data.usuario.nombre?.trim() || data.usuario.email, role: roleFor(data.usuario, tenant.rol_tenant), trygestionUserId: data.usuario.id, tenant: tenant.nombre ?? tenant.id };
}

/** Limita intentos fallidos por email (memoria del proceso; una instancia). */
const failures = new Map<string, { count: number; until: number }>();
export function loginBlocked(key: string, now = Date.now()) { const entry = failures.get(key); return Boolean(entry && entry.count >= 5 && entry.until > now); }
export function registerLoginFailure(key: string, now = Date.now()) {
  const entry = failures.get(key); const fresh = !entry || entry.until <= now;
  failures.set(key, { count: fresh ? 1 : entry!.count + 1, until: now + 15 * 60_000 });
}
export function clearLoginFailures(key: string) { failures.delete(key); }
