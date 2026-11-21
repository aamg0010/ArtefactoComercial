import { expect, it, vi } from 'vitest';
import { crawlCompanyWebsite, htmlText, isPublicAddress, robotsAllowed, isCanonicalRedirect } from './crawler';

it('robots respeta el agente específico, las exclusiones y la regla más precisa', () => {
  const robots = 'User-agent: *\nDisallow: /\nUser-agent: try-comercial-bot\nDisallow: /privado\nAllow: /privado/contacto$';
  expect(robotsAllowed(robots, '/')).toBe(true);
  expect(robotsAllowed(robots, '/privado')).toBe(false);
  expect(robotsAllowed(robots, '/privado/contacto')).toBe(true);
});
it('bloquea redes privadas, loopback y direcciones locales IPv6', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.0.1', '172.16.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1']) expect(isPublicAddress(ip)).toBe(false);
  expect(isPublicAddress('8.8.8.8')).toBe(true);
});
it('extrae texto sin scripts ni estilos y explicita la ausencia de web', async () => {
  expect(htmlText('<style>oculto</style><script>malicioso</script><p>Empresa &amp; datos</p>')).toBe('Empresa & datos');
  expect(await crawlCompanyWebsite(null)).toMatchObject({ sources: [], note: expect.stringContaining('Sin web') });
});
it('consulta robots y como máximo tres páginas de la propia web', async () => {
  const request = vi.fn(async (url: URL) => ({ status: 200, text: url.pathname === '/robots.txt' ? 'User-agent: *\nDisallow: /contacto-privado' : '<p>Empresa</p><a href="/contacto">Contacto</a><a href="/nosotros">Nosotros</a><a href="/empresa">Empresa</a><a href="https://ajena.test/contacto">Ajena</a>' }));
  const result = await crawlCompanyWebsite('https://empresa.test', request);
  expect(request.mock.calls.map(([url]) => url.href)).toEqual(['https://empresa.test/robots.txt', 'https://empresa.test/', 'https://empresa.test/contacto', 'https://empresa.test/nosotros']);
  expect(result.sources).toHaveLength(3);
});
it('no descarga ninguna página cuando robots la excluye', async () => {
  const request = vi.fn(async () => ({ status: 200, text: 'User-agent: *\nDisallow: /' }));
  expect((await crawlCompanyWebsite('https://empresa.test', request)).sources).toHaveLength(0);
  expect(request).toHaveBeenCalledTimes(1);
});

it.each([
  ['https://empresa.test', 'https://www.empresa.test'],
  ['https://www.empresa.test', 'https://empresa.test'],
  ['http://empresa.test', 'https://empresa.test'],
  ['http://empresa.test', 'https://www.empresa.test'],
])('sigue la redirección canónica %s → %s consultando robots del destino', async (origin, target) => {
  const request = vi.fn(async (url: URL) => {
    if (url.pathname === '/robots.txt') return { status: 200, text: 'User-agent: *\nAllow: /' };
    if (url.origin === origin) return { status: 301, text: '', location: `${target}/` };
    return { status: 200, text: '<p>Empresa pública</p>' };
  });
  const result = await crawlCompanyWebsite(origin, request);
  expect(request.mock.calls.map(([url]) => url.href)).toEqual([`${origin}/robots.txt`, `${origin}/`, `${target}/robots.txt`, `${target}/`]);
  expect(result.sources).toHaveLength(1);
  expect(result.sources[0].url).toBe(`${target}/`);
});
it('respeta el robots del nuevo origen antes de seguir una redirección', async () => {
  const request = vi.fn(async (url: URL) => url.pathname === '/robots.txt'
    ? { status: 200, text: url.hostname.startsWith('www.') ? 'User-agent: *\nDisallow: /' : '' }
    : { status: 301, text: '', location: 'https://www.empresa.test/' });
  expect((await crawlCompanyWebsite('https://empresa.test', request)).sources).toHaveLength(0);
  expect(request.mock.calls.map(([url]) => url.href)).toEqual(['https://empresa.test/robots.txt', 'https://empresa.test/', 'https://www.empresa.test/robots.txt']);
});
it.each(['https://otra-empresa.test/', 'https://empresa.test.ajena.test/'])('rechaza la redirección a otro dominio %s sin solicitarlo', async destination => {
  const request = vi.fn(async (url: URL) => url.pathname === '/robots.txt' ? { status: 200, text: '' } : { status: 302, text: '', location: destination });
  expect((await crawlCompanyWebsite('https://empresa.test', request)).sources).toHaveLength(0);
  expect(request.mock.calls.map(([url]) => url.origin)).toEqual(['https://empresa.test', 'https://empresa.test']);
});
it('no descarga el destino si su nueva comprobación de DNS público falla', async () => {
  const request = vi.fn(async (url: URL) => {
    if (url.hostname.startsWith('www.')) throw new Error('Destino privado o reservado');
    return url.pathname === '/robots.txt' ? { status: 200, text: '' } : { status: 301, text: '', location: 'https://www.empresa.test/' };
  });
  expect((await crawlCompanyWebsite('https://empresa.test', request)).sources).toHaveLength(0);
  expect(request.mock.calls.map(([url]) => url.href)).toEqual(['https://empresa.test/robots.txt', 'https://empresa.test/', 'https://www.empresa.test/robots.txt']);
});
it('admite robots redirigido al alias canónico y comprueba sus reglas', async () => {
  const request = vi.fn(async (url: URL) => {
    if (!url.hostname.startsWith('www.')) return { status: 301, text: '', location: `https://www.empresa.test${url.pathname}` };
    return { status: 200, text: url.pathname === '/robots.txt' ? 'User-agent: *\nAllow: /' : '<p>Empresa</p>' };
  });
  expect((await crawlCompanyWebsite('https://empresa.test', request)).sources[0].url).toBe('https://www.empresa.test/');
  expect(request.mock.calls.map(([url]) => url.href)).toEqual(['https://empresa.test/robots.txt', 'https://www.empresa.test/robots.txt', 'https://empresa.test/', 'https://www.empresa.test/']);
});
it('rechaza subdominios arbitrarios, credenciales, puertos y downgrades HTTPS', () => {
  const base = new URL('https://empresa.test');
  for (const url of ['https://otra.empresa.test', 'http://empresa.test', 'https://www.empresa.test:8443', 'https://usuario@www.empresa.test']) expect(isCanonicalRedirect(base, new URL(url))).toBe(false);
});
