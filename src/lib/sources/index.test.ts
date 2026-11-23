import { afterEach, expect, it, vi } from 'vitest';
import { prospectingSimulated, sourceAdapter } from './index';
import { OpenStreetMapAdapter, OverpassGate, overpassEndpoints } from './openstreetmap';
import type { SearchCriteria } from './types';

const criteria: SearchCriteria = { country: 'ES', provinces: ['Teruel'], comarcas: [], municipalities: ['Alcañiz'], keywords: ['bodega'], cnaeCodes: [], productLine: 'Athenea', maxResults: 10 };
afterEach(() => vi.unstubAllEnvs());

it('en producción sin clave de Google no inventa empresas: la fuente avisa de que falta la clave', async () => {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('GOOGLE_PLACES_API_KEY', ''); vi.stubEnv('PROSPECTING_ALLOW_MOCK', '');
  expect(prospectingSimulated()).toBe(false);
  for (const source of ['google-places', 'mock'] as const) await expect(sourceAdapter(source).search(criteria)).rejects.toMatchObject({ code: 'GOOGLE_PLACES_NOT_CONFIGURED' });
});

it('la simulación sigue disponible en desarrollo o si se permite expresamente (pruebas E2E)', () => {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('GOOGLE_PLACES_API_KEY', ''); vi.stubEnv('PROSPECTING_ALLOW_MOCK', '1');
  expect(sourceAdapter('mock').id).toBe('mock');
  vi.stubEnv('PROSPECTING_ALLOW_MOCK', ''); vi.stubEnv('NODE_ENV', 'development');
  expect(sourceAdapter('google-places').id).toBe('mock');
});

it('si un servidor Overpass falla (502), el reintento usa el siguiente de la lista', async () => {
  vi.stubEnv('OVERPASS_URL', 'https://a.example.test/api, https://b.example.test/api');
  expect(overpassEndpoints()).toEqual(['https://a.example.test/api', 'https://b.example.test/api']);
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 502 })).mockResolvedValueOnce(new Response('{"elements":[]}'));
  const gate = new OverpassGate(vi.fn().mockResolvedValue(undefined), () => 0);
  await new OpenStreetMapAdapter({ fetcher, gate, pause: vi.fn().mockResolvedValue(undefined) }).search(criteria);
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(['https://a.example.test/api', 'https://b.example.test/api']);
});

it('sin configuración usa varios servidores públicos de Overpass', () => {
  vi.stubEnv('OVERPASS_URL', '');
  expect(overpassEndpoints().length).toBeGreaterThan(1);
});
