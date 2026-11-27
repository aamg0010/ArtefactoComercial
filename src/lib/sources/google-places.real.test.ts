import { expect, it, vi } from 'vitest';
import { GooglePlacesAdapter } from './google-places';
import type { SearchCriteria } from './types';

const criteria: SearchCriteria = { country: 'ES', provinces: ['Teruel'], comarcas: [], municipalities: ['Alcañiz'], keywords: ['almazara'], cnaeCodes: [], productLine: 'Athenea', maxResults: 5 };
const address = (city: string) => [
  { longText: 'Teruel', shortText: 'TE', types: ['administrative_area_level_2', 'political'] },
  { longText: city, shortText: city, types: ['locality', 'political'] },
  { longText: 'España', shortText: 'ES', types: ['country', 'political'] },
];

it('acepta respuestas reales de Google con partes de dirección sin `types` y descarta solo el lugar mal formado', async () => {
  const body = { places: [
    // Caso real (23/11/2026): la primera parte de la dirección llega sin `types`.
    { id: 'p1', displayName: { text: 'Almazara uno' }, addressComponents: [{ longText: 'S N, Carretera Escatrón, 0', languageCode: 'es' }, ...address('Alcañiz')], websiteUri: 'https://uno.example.test', internationalPhoneNumber: '+34 978 000 001' },
    // Lugar mal formado (sin nombre): se ignora, no tumba la búsqueda.
    { id: 'p2', addressComponents: address('Alcañiz') },
    { id: 'p3', displayName: { text: 'Almazara tres' }, addressComponents: address('Alcañiz') },
  ] };
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
  const found = await new GooglePlacesAdapter('clave-de-prueba', { fetcher, maxPages: 1, maxQueries: 1 }).search(criteria);
  expect(found.map(item => item.name)).toEqual(['Almazara uno', 'Almazara tres']);
  expect(found[0]).toMatchObject({ city: 'Alcañiz', province: 'Teruel', source: 'google-places' });
  expect(found[0].website).toContain('uno.example.test');
});


it('displayName solicita únicamente id,displayName, sin caché y con timeout corto', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'ChIJtest', displayName: { text: 'Empresa real' } })));
  expect(await new GooglePlacesAdapter('fake', { fetcher }).displayName('ChIJtest')).toBe('Empresa real');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', cache: 'no-store', headers: { 'X-Goog-FieldMask': 'id,displayName' } });
  expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});
it('displayName conserva errores HTTP, de red y de validación sin reintentos lentos', async () => {
  for (const [fetcher, code] of [
    [vi.fn().mockResolvedValue(new Response('', { status: 429 })), 'GOOGLE_HTTP_429'],
    [vi.fn().mockRejectedValue(new Error('offline')), 'GOOGLE_NETWORK_ERROR'],
    [vi.fn().mockResolvedValue(new Response('{}')), 'GOOGLE_RESPONSE_INVALID'],
  ] as const) {
    await expect(new GooglePlacesAdapter('fake', { fetcher }).displayName('id')).rejects.toThrow(code);
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});

it('displayName aborta una petición lenta a los cinco segundos', async () => {
  vi.useFakeTimers();
  try {
    let signal!: AbortSignal;
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      signal = init!.signal!;
      return new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    });
    // Native AbortSignal.timeout has its own clock; substitute it for this test.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    const result = expect(new GooglePlacesAdapter('fake', { fetcher }).displayName('slow')).rejects.toThrow('GOOGLE_NETWORK_ERROR');
    await vi.advanceTimersByTimeAsync(4999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    await result;
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
});
