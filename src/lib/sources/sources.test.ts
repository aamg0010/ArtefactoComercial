import { afterEach, expect, it, vi } from 'vitest';
import { GooglePlacesAdapter, placesFieldMask } from './google-places';
import { sourceAdapter } from './index';
import { csvCandidates } from './csv';
import type { SearchCriteria } from './types';

const criteria: SearchCriteria = { country: 'ES', provinces: ['Teruel'], comarcas: ['Bajo Aragón'], municipalities: ['Alcañiz'], keywords: ['almazara'], cnaeCodes: [], productLine: 'Athenea', maxResults: 10 };
const place = (id: string) => ({ id, displayName: { text: `Empresa ${id}` }, formattedAddress: 'Dirección corporativa', addressComponents: [{ longText: 'España', shortText: 'ES', types: ['country'] }, { longText: 'Alcañiz', types: ['locality'] }], websiteUri: 'https://empresa.test', internationalPhoneNumber: '+34 976632132', primaryType: 'store' });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('Google pagina con nextPageToken, limita las páginas y usa una field mask mínima', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ places: [place('p1')], nextPageToken: 'next-1' }))).mockResolvedValueOnce(new Response(JSON.stringify({ places: [place('p2')], nextPageToken: 'next-2' })));
  const candidates = await new GooglePlacesAdapter('fake-key', { fetcher, maxPages: 2 }).search(criteria);
  expect(candidates.map(item => item.sourceRef)).toEqual(['p1', 'p2']); expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0][0]).toBe('https://places.googleapis.com/v1/places:searchText');
  const options = fetcher.mock.calls[0][1];
  expect(options.headers['X-Goog-FieldMask']).toBe(placesFieldMask); expect(placesFieldMask).not.toContain('*'); expect(placesFieldMask).not.toMatch(/reviews|photos|email|author/i);
  expect(options.cache).toBe('no-store'); expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.parse(options.body)).toMatchObject({ textQuery: 'almazara en Alcañiz, Teruel', regionCode: 'ES' });
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ pageToken: 'next-1', textQuery: 'almazara en Alcañiz, Teruel' });
});
it('Google reintenta un 429 con espera sin cambiar a mock', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('rate limit', { status: 429 })).mockResolvedValueOnce(new Response(JSON.stringify({ places: [place('p1')] })));
  const pause = vi.fn().mockResolvedValue(undefined);
  expect(await new GooglePlacesAdapter('fake-key', { fetcher, pause }).search(criteria)).toHaveLength(1);
  expect(pause).toHaveBeenCalledWith(1000); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('Google respeta el máximo total y no pide una página extra', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ places: [place('p1'), place('p2')], nextPageToken: 'next' })));
  expect(await new GooglePlacesAdapter('fake-key', { fetcher }).search({ ...criteria, maxResults: 1 })).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('un 403 falla sin reintentos ni exposición del cuerpo de error', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('datos privados', { status: 403 }));
  await expect(new GooglePlacesAdapter('fake-key', { fetcher }).search(criteria)).rejects.toThrow('GOOGLE_HTTP_403');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('Google descarta resultados de otro país o municipio', async () => {
  const wrongCountry = { ...place('co'), addressComponents: [{ longText: 'Colombia', shortText: 'CO', types: ['country'] }, { longText: 'Alcañiz', types: ['locality'] }] };
  const wrongCity = { ...place('wrong-city'), addressComponents: [{ longText: 'España', shortText: 'ES', types: ['country'] }, { longText: 'Madrid', types: ['locality'] }] };
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ places: [wrongCountry, wrongCity, place('correct')] })));
  expect((await new GooglePlacesAdapter('fake-key', { fetcher }).search(criteria)).map(item => item.sourceRef)).toEqual(['correct']);
});
it('sin clave el mock es determinista, ficticio y sin red; con clave nunca se selecciona', async () => {
  vi.stubEnv('GOOGLE_PLACES_API_KEY', ''); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const adapter = sourceAdapter('google-places'); const first = await adapter.search({ ...criteria, maxResults: 2 });
  expect(await adapter.search({ ...criteria, maxResults: 2 })).toEqual(first);
  expect(first.every(item => item.name.startsWith('[SIMULADA]') && item.simulated)).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
  vi.stubEnv('GOOGLE_PLACES_API_KEY', 'fake-key'); expect(sourceAdapter('mock').id).toBe('google-places');
  await expect(adapter.search(criteria)).rejects.toThrow('MOCK_DISABLED');
});
it('CSV reutiliza el parser pero descarta nombres y emails de personas', () => {
  const result = csvCandidates('empresa,municipio,provincia,pais,telefono,contacto,emailContacto\nEmpresa,Alcañiz,Teruel,ES,976632132,Ana Personal,ana@example.test');
  expect(result[0]).toMatchObject({ name: 'Empresa', city: 'Alcañiz', corporatePhone: '976632132', source: 'csv' });
  expect(JSON.stringify(result)).not.toContain('Ana Personal'); expect(JSON.stringify(result)).not.toContain('ana@example.test');
});
it.each(['apollo', 'linkedin-export'] as const)('%s es un stub explícito sin red', async source => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(sourceAdapter(source).search(criteria)).rejects.toThrow('SOURCE_NOT_IMPLEMENTED'); expect(fetcher).not.toHaveBeenCalled();
});
