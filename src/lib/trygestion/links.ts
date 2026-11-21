/**
 * Enlaces entre try! Comercial y trygestión.
 * - TRYGESTION_WEB_URL: web de trygestión (por defecto https://trygestion.com, donde las pantallas están en la raíz).
 * - APP_PUBLIC_URL: dirección con la que el equipo abre try! Comercial (p. ej. la de Tailscale); se escribe en trygestión.
 */
type Environment = Record<string, string | undefined>;
const clean = (value: string | undefined) => {
  const candidate = value?.trim().replace(/\/+$/, '');
  if (!candidate) return null;
  try { const url = new URL(candidate); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? candidate : null; } catch { return null; }
};
export function trygestionWebUrl(env: Environment = process.env) { return clean(env.TRYGESTION_WEB_URL) ?? 'https://trygestion.com'; }
export function trygestionEmpresaUrl(empresaId: string, env: Environment = process.env) { return `${trygestionWebUrl(env)}/empresas?ver=${encodeURIComponent(empresaId)}`; }
export function trygestionPipelineUrl(env: Environment = process.env) { return `${trygestionWebUrl(env)}/pipeline`; }
export function appPublicUrl(env: Environment = process.env) { return clean(env.APP_PUBLIC_URL); }
export function appCompanyUrl(companyId: string, env: Environment = process.env) { const base = appPublicUrl(env); return base ? `${base}/empresas/${encodeURIComponent(companyId)}` : null; }
