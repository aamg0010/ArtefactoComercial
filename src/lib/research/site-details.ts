import { businessPhone, corporateEmail } from '../company-contact';

export type SiteBusiness = { url: string; date: string; name?: string; city?: string; phone?: string; email?: string };
function text(value: string) { return value.replace(/<[^>]*>/g, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim(); }
export function extractSiteBusiness(html: string, url: string, date: string): SiteBusiness {
  const result: SiteBusiness = { url, date };
  // Only organization objects. Never extract a Person, owner or employee.
  const scan = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(scan); return; }
    const item = value as Record<string, unknown>;
    const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
    if (types.some(type => typeof type === 'string' && /^(Organization|Corporation|LocalBusiness|Store|Winery|AutoRepair|FoodEstablishment)$/.test(type))) {
      if (typeof item.name === 'string') result.name ??= text(item.name).slice(0, 250);
      if (typeof item.telephone === 'string') result.phone ??= businessPhone(item.telephone) ?? undefined;
      if (typeof item.email === 'string') result.email ??= corporateEmail(item.email) ?? undefined;
      const address = item.address as Record<string, unknown> | undefined;
      if (address && typeof address.addressLocality === 'string') result.city ??= text(address.addressLocality);
    }
    if (item['@graph']) scan(item['@graph']);
  };
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { scan(JSON.parse(match[1])); } catch { /* Invalid structured data is not a proposal. */ }
  }
  const siteTag = [...html.matchAll(/<meta\b[^>]*>/gi)].find(match => /(?:property|name)=["']og:site_name["']/i.test(match[0]));
  const siteName = siteTag?.[0].match(/content=["']([^"']*)["']/i)?.[1];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  result.name ??= siteName ? text(siteName) : title ? text(title).split(/\s[|–-]\s/)[0] : undefined;
  if (result.name && /^(inicio|home|bienvenidos?)$/i.test(result.name)) delete result.name;
  for (const match of html.matchAll(/href\s*=\s*["']mailto:([^?"']+)/gi)) result.email ??= corporateEmail(match[1]) ?? undefined;
  for (const match of html.matchAll(/href\s*=\s*["']tel:([^"']+)/gi)) result.phone ??= businessPhone(match[1]) ?? undefined;
  return result;
}
