import { normalizeDomain, normalizeText } from '../normalization';

export function normalizedBusinessName(value: string) {
  return normalizeText(value).replace(/\b(?:sociedad cooperativa|sociedad limitada unipersonal|sociedad anonima unipersonal|sociedad limitada|sociedad anonima|s coop|s co op|s c l|s l u|s a u|s l|s a|s c|scoop|slu|sau|sl|sa)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
export function normalizedNif(value?: string | null) { return value?.replace(/[^a-z0-9]/gi, '').toUpperCase() || null; }
export function normalizedPhone(value?: string | null, country?: string | null) {
  let digits = value?.replace(/\D/g, '') || '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (country === 'ES' && digits.length === 9) digits = `34${digits}`;
  if (country === 'CO' && digits.length === 10) digits = `57${digits}`;
  return digits || null;
}
export type Identity = { name: string; city: string | null; country: string; nifNit?: string | null; website?: string | null; normalizedDomain?: string | null; source?: string; sourceRef?: string; sourceIdentities?: { source: string; sourceRef: string }[] };
export function duplicateReason(a: Identity, b: Identity) {
  if (normalizedNif(a.nifNit) && normalizedNif(a.nifNit) === normalizedNif(b.nifNit)) return 'NIF';
  const domain = a.normalizedDomain || normalizeDomain(a.website);
  if (domain && domain === (b.normalizedDomain || normalizeDomain(b.website))) return 'DOMAIN';
  if (a.source && a.sourceRef && b.sourceIdentities?.some(identity => identity.source === a.source && identity.sourceRef === a.sourceRef)) return 'SOURCE_REF';
  if (a.country === b.country && normalizedBusinessName(a.name) === normalizedBusinessName(b.name) && normalizeText(a.city ?? '') === normalizeText(b.city ?? '')) return 'NAME_CITY';
  return null;
}
