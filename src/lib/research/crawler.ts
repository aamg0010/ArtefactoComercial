import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import type { Evidence } from './schema';
import { extractSiteBusiness, type SiteBusiness } from './site-details';

const userAgent = 'try-comercial-bot';
const maxBytes = 200 * 1024;
export function isPublicAddress(address: string) {
  if (isIP(address) === 6) return /^2[0-9a-f]{3}:/i.test(address) && !/^2001:(?:db8|0):/i.test(address);
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19));
}

/** Pin the validated DNS answer to the socket to prevent DNS rebinding. */
async function requestPage(url: URL, origin: string): Promise<{ status: number; text: string; location?: string }> {
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || url.username || url.password || !['', '80', '443'].includes(url.port)) throw new Error('URL no permitida');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const addresses = await Promise.race([
      lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true }),
      new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Timeout DNS')), { once: true })),
    ]);
    if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('Destino privado o reservado');
    const pinned = addresses[0];
    const response = await new Promise<{ status: number; text: string; location?: string }>((resolve, reject) => {
      const request = (url.protocol === 'https:' ? https : http).get(url, {
        signal: controller.signal,
        family: pinned.family,
        headers: { 'user-agent': userAgent, accept: 'text/html,text/plain', 'accept-encoding': 'identity' },
        lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
      }, res => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) { res.destroy(); resolve({ status, text: '', location: res.headers.location }); return; }
        if (Number(res.headers['content-length'] ?? 0) > maxBytes) { res.destroy(); reject(new Error('Página demasiado grande')); return; }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) res.destroy(new Error('Página demasiado grande'));
          else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => resolve({ status, text: Buffer.concat(chunks).toString('utf8') }));
      });
      request.on('error', reject);
    });
    return response;
  } finally { clearTimeout(timer); }
}

export function robotsAllowed(text: string, path: string) {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let group = { agents: [] as string[], rules: [] as { allow: boolean; path: string }[] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0];
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === 'user-agent') {
      if (group.rules.length) { groups.push(group); group = { agents: [], rules: [] }; }
      group.agents.push(value.toLowerCase());
    } else if (['allow', 'disallow'].includes(key) && value) group.rules.push({ allow: key === 'allow', path: value });
  }
  groups.push(group);
  const specific = groups.filter(item => item.agents.some(agent => agent !== '*' && userAgent.includes(agent)));
  const applicable = specific.length ? specific : groups.filter(item => item.agents.includes('*'));
  const matches = applicable.flatMap(item => item.rules).filter(rule => {
    const pattern = rule.path.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${pattern}`).test(path);
  }).sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return matches[0]?.allow ?? true;
}

export function htmlText(html: string) {
  return html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'").replace(/\s+/g, ' ').trim();
}

/** Only canonical aliases of this exact hostname, never arbitrary subdomains. */
export function isCanonicalRedirect(from: URL, to: URL) {
  const base = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, '');
  return ['http:', 'https:'].includes(to.protocol) && !to.username && !to.password &&
    !to.port && base(from) === base(to) && !(from.protocol === 'https:' && to.protocol === 'http:');
}

class RobotsDenied extends Error {}

export async function crawlCompanyWebsite(website: string | null, request = requestPage): Promise<{ sources: Evidence[]; note: string; business?: SiteBusiness[] }> {
  if (!website) return { sources: [], note: 'Sin web: ficha basada únicamente en los datos registrados en el CRM.' };
  try {
    let home = new URL(website.includes('://') ? website : `https://${website}`);
    home.pathname = '/'; home.search = ''; home.hash = '';
    const robotsCache = new Map<string, string>();
    async function loadRobots(origin: string) {
      const cached = robotsCache.get(origin);
      if (cached !== undefined) return cached;
      let url = new URL('/robots.txt', origin);
      for (let redirects = 0; redirects <= 4; redirects++) {
        // requestPage validates and pins public DNS again for every new origin.
        const response = await request(url, url.origin);
        if (response.location && response.status >= 300 && response.status < 400) {
          const next = new URL(response.location, url);
          if (!isCanonicalRedirect(url, next) || next.pathname !== '/robots.txt') throw new Error('Redirección de robots no permitida');
          url = next; continue;
        }
        if (response.status !== 200 && response.status !== 404) throw new Error('robots.txt no disponible');
        const rules = response.status === 404 ? '' : response.text;
        robotsCache.set(origin, rules); robotsCache.set(url.origin, rules);
        return rules;
      }
      throw new Error('Demasiadas redirecciones de robots');
    }
    async function fetchAllowedPage(initial: URL) {
      let url = initial;
      for (let redirects = 0; redirects <= 4; redirects++) {
        const robots = await loadRobots(url.origin);
        if (!robotsAllowed(robots, url.pathname + url.search)) throw new RobotsDenied();
        const response = await request(url, url.origin);
        if (response.location && response.status >= 300 && response.status < 400) {
          const next = new URL(response.location, url);
          if (!isCanonicalRedirect(url, next)) throw new Error('Redirección fuera de la web de empresa');
          url = next; continue;
        }
        return { ...response, url };
      }
      throw new Error('Demasiadas redirecciones');
    }
    const result = await fetchAllowedPage(home);
    if (result.status !== 200) throw new Error('Home no disponible');
    home = result.url;
    const sources: Evidence[] = [{ id: 'web-1', url: home.href, date: new Date().toISOString(), text: htmlText(result.text).slice(0, 30_000) || 'Web sin texto extraíble' }];
    const business = [extractSiteBusiness(result.text, home.href, sources[0].date)];
    const links = [...result.text.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(match => {
      try { return new URL(match[1], home); } catch { return null; }
    }).filter((url): url is URL => Boolean(url && url.origin === home.origin && /contact|quienes|qui[eé]nes|about|nosotros|empresa/i.test(url.pathname)));
    const visited = new Set([home.href]);
    for (const url of links) {
      url.hash = ''; url.search = '';
      if (visited.size === 3) break;
      if (visited.has(url.href)) continue;
      visited.add(url.href);
      try {
        const page = await fetchAllowedPage(url);
        if (page.status === 200) {
          const date = new Date().toISOString();
          sources.push({ id: `web-${sources.length + 1}`, url: page.url.href, date, text: htmlText(page.text).slice(0, 30_000) || 'Sin texto extraíble' });
          business.push(extractSiteBusiness(page.text, page.url.href, date));
        }
      } catch { /* A failed optional page is not evidence. */ }
    }
    return { sources, business, note: `${sources.length} páginas públicas consultadas respetando robots.txt.` };
  } catch (error) { return { sources: [], note: error instanceof RobotsDenied ? 'robots.txt impide investigar esta web; se usan datos del CRM.' : 'Web no consultable de forma segura; ficha basada en el CRM, pendiente de verificar.' }; }
}
