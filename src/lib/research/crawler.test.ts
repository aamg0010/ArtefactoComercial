import { expect, it, vi } from 'vitest';
import { crawlCompanyWebsite, htmlText, isPublicAddress, robotsAllowed } from './crawler';

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
