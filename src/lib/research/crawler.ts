import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import type { Evidence } from './schema';

const userAgent = 'try-comercial-bot';
const maxBytes = 200 * 1024;
export function isPublicAddress(address: string) {
  if (isIP(address) === 6) return /^2[0-9a-f]{3}:/i.test(address) && !/^2001:(?:db8|0):/i.test(address);
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19));
}

/** Pin the validated DNS answer to the socket to prevent DNS rebinding. */
async function requestPage(url: URL, origin: string, redirects = 0): Promise<{ status: number; text: string }> {
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
        if (status >= 300 && status < 400) { res.resume(); resolve({ status, text: '', location: res.headers.location }); return; }
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
    // Do not bypass a robots decision by following a page redirect to another path.
    if (response.location) {
      const next = new URL(response.location, url);
      if (redirects >= 2 || next.pathname !== url.pathname) throw new Error('Redirección no permitida');
      return requestPage(next, origin, redirects + 1);
    }
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

export async function crawlCompanyWebsite(website: string | null, request = requestPage): Promise<{ sources: Evidence[]; note: string }> {
  if (!website) return { sources: [], note: 'Sin web: ficha basada únicamente en los datos registrados en el CRM.' };
  try {
    const home = new URL(website.includes('://') ? website : `https://${website}`);
    home.pathname = '/'; home.search = ''; home.hash = '';
    const robots = await request(new URL('/robots.txt', home), home.origin);
    if (robots.status !== 200 && robots.status !== 404) throw new Error('robots.txt no disponible');
    const allowed = (url: URL) => robotsAllowed(robots.status === 404 ? '' : robots.text, url.pathname + url.search);
    if (!allowed(home)) return { sources: [], note: 'robots.txt impide investigar esta web; se usan datos del CRM.' };
    const result = await request(home, home.origin);
    if (result.status !== 200) throw new Error('Home no disponible');
    const sources: Evidence[] = [{ id: 'web-1', url: home.href, date: new Date().toISOString(), text: htmlText(result.text).slice(0, 30_000) || 'Web sin texto extraíble' }];
    const links = [...result.text.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(match => {
      try { return new URL(match[1], home); } catch { return null; }
    }).filter((url): url is URL => Boolean(url && url.origin === home.origin && /contact|quienes|qui[eé]nes|about|nosotros|empresa/i.test(url.pathname)));
    const visited = new Set([home.href]);
    for (const url of links) {
      url.hash = ''; url.search = '';
      if (visited.size === 3) break;
      if (visited.has(url.href) || !allowed(url)) continue;
      visited.add(url.href);
      try {
        const page = await request(url, home.origin);
        if (page.status === 200) sources.push({ id: `web-${sources.length + 1}`, url: url.href, date: new Date().toISOString(), text: htmlText(page.text).slice(0, 30_000) || 'Sin texto extraíble' });
      } catch { /* A failed optional page is not evidence. */ }
    }
    return { sources, note: `${sources.length} páginas públicas consultadas respetando robots.txt.` };
  } catch { return { sources: [], note: 'Web no consultable de forma segura; ficha basada en el CRM, pendiente de verificar.' }; }
}
