import { afterEach, expect, it, vi } from 'vitest';
import { CITY_PENDING, EinformaAdapter, einformaCredentials } from './einforma';
import { sourceAdapter } from './index';
import type { SearchCriteria } from './types';

const criteria: SearchCriteria = { country: 'ES', provinces: ['Teruel'], comarcas: [], municipalities: ['Alcañiz'], keywords: ['almazara'], cnaeCodes: [], productLine: 'Athenea', maxResults: 3 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const empresa = (id: string, provincia: string) => ({ id, denominacion: `ALMAZARA ${id} SL`, tipoDenominacion: 'Denominación principal', provincia });
afterEach(() => vi.unstubAllEnvs());

/** Servidor eInforma simulado: token + buscador paginado (rows/start), como la API real. */
function fakeApi(pages: unknown[][], total: number) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) return json({ access_token: 'token-de-prueba-1234', token_type: 'Bearer', expires_in: 3600 });
    const params = new URL(url).searchParams;
    return json({ total, empresa: pages[Number(params.get('start')) / Number(params.get('rows'))] ?? [] });
  });
}

it('busca por razón social, pagina con rows/start y se queda solo con las empresas de las provincias del perfil', async () => {
  const fetcher = fakeApi([[empresa('A', 'Cádiz'), empresa('B', 'Teruel')], [empresa('C', 'Jaén'), empresa('D', 'Teruel')]], 100);
  const queries: string[] = [];
  const found = await new EinformaAdapter({ clientId: 'id', clientSecret: 'secreto' }, { fetcher, maxPages: 2 }).search({ ...criteria, onQuery: q => queries.push(q) });
  expect(found.map(item => item.sourceRef)).toEqual(['B', 'D']);
  expect(found[0]).toMatchObject({ name: 'ALMAZARA B SL', province: 'Teruel', city: CITY_PENDING, source: 'einforma', category: 'almazara', simulated: false });
  const searches = fetcher.mock.calls.map(call => String(call[0])).filter(url => url.includes('/companies'));
  expect(searches).toHaveLength(2);
  expect(new URL(searches[1]).searchParams.get('start')).toBe('50');
  expect(queries[0]).toContain('almazara');
  // El token se pide una sola vez y se reutiliza.
  expect(fetcher.mock.calls.filter(call => String(call[0]).endsWith('/oauth/token'))).toHaveLength(1);
});

it('renueva el token si eInforma responde 401 y no sigue paginando al llegar al total', async () => {
  let first = true;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) return json({ access_token: 'token-de-prueba-1234', expires_in: 3600 });
    if (first) { first = false; return json({ status: 401, message: 'Unauthorized' }, 401); }
    return json({ total: 1, empresa: empresa('B', 'Teruel') });
  });
  const found = await new EinformaAdapter({ clientId: 'id', clientSecret: 'secreto' }, { fetcher, maxPages: 5 }).search(criteria);
  expect(found.map(item => item.sourceRef)).toEqual(['B']);
  expect(fetcher.mock.calls.filter(call => String(call[0]).endsWith('/oauth/token'))).toHaveLength(2);
  expect(fetcher.mock.calls.filter(call => String(call[0]).includes('/companies'))).toHaveLength(2);
});

it('descarta empresas extinguidas, en liquidación y comunidades de propietarios', async () => {
  const names = ['CDAD PROP EDIFICIO "LA ALMAZARA"', 'EDIFICIO LA ALMAZARA SL. (EXTINGUIDA)', 'ACEITES EJEMPLO SL EN LIQUIDACION', 'ECOSUR COOP DE VIVIENDAS S.COOP.', 'COOPERATIVA ATALAYA'];
  const fetcher = fakeApi([names.map((denominacion, index) => ({ id: `X${index}`, denominacion, provincia: 'Teruel' }))], 4);
  const found = await new EinformaAdapter({ clientId: 'id', clientSecret: 'secreto' }, { fetcher, maxPages: 1 }).search({ ...criteria, maxResults: 10 });
  expect(found.map(item => item.name)).toEqual(['COOPERATIVA ATALAYA']);
});

it('credenciales rechazadas y perfiles fuera de España dan errores claros', async () => {
  const denied = vi.fn(async () => json({ error: 'invalid_client' }, 401));
  await expect(new EinformaAdapter({ clientId: 'id', clientSecret: 'mal' }, { fetcher: denied }).search(criteria)).rejects.toMatchObject({ code: 'EINFORMA_TOKEN_HTTP_401' });
  await expect(new EinformaAdapter({ clientId: 'id', clientSecret: 'x' }, { fetcher: denied }).search({ ...criteria, country: 'CO' })).rejects.toMatchObject({ code: 'EINFORMA_ONLY_SPAIN' });
});

it('sin credenciales la fuente avisa en lugar de fallar en silencio', async () => {
  vi.stubEnv('EINFORMA_CLIENT_ID', ''); vi.stubEnv('EINFORMA_CLIENT_SECRET', '');
  expect(einformaCredentials()).toBeNull();
  await expect(sourceAdapter('einforma').search(criteria)).rejects.toMatchObject({ code: 'EINFORMA_NOT_CONFIGURED' });
  vi.stubEnv('EINFORMA_CLIENT_ID', 'id'); vi.stubEnv('EINFORMA_CLIENT_SECRET', 'secreto');
  expect(sourceAdapter('einforma').id).toBe('einforma');
});
