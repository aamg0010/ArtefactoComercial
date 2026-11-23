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
