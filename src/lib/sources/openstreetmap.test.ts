import { expect, it, vi } from 'vitest';
import { OpenStreetMapAdapter, OverpassGate, osmTagFilters, overpassQuery, osmAttribution } from './openstreetmap';
import type { SearchCriteria } from './types';

const criteria: SearchCriteria = { country: 'ES', provinces: ['Teruel'], comarcas: ['Bajo Aragón'], municipalities: ['Alcañiz'], keywords: ['bodega'], cnaeCodes: [], productLine: 'Athenea', maxResults: 10 };
const fakeGate = () => new OverpassGate(vi.fn().mockResolvedValue(undefined), () => 0);
it.each([['bodega', 'craft', 'winery'], ['almazara', 'craft', 'oil_mill'], ['granja porcina', 'landuse', 'farmyard'], ['taller', 'shop', 'car_repair'], ['gestoría', 'office', 'accountant'], ['otros', 'amenity', '*']])('mapea %s a %s=%s', (keyword, key, value) => {
  expect(osmTagFilters(keyword)).toContainEqual([key, value]);
});
it('la consulta acota país, provincia y municipio administrativo 8 y escapa la entrada', () => {
  const query = overpassQuery('Alcañiz', 'Teruel', 'ES', ['bodega ");out;'], 5);
  expect(query).toContain('["ISO3166-1"="ES"]'); expect(query).toContain('area(area.province)');
  expect(query).toContain('["admin_level"="8"]'); expect(query).toContain('^Alcañiz$');
  expect(query).toContain('["craft"="winery"]'); expect(query).toContain('["name"~'); expect(query).toContain('out tags 5');
});
it('sólo devuelve elementos con nombre, contacto corporativo y atribución ODbL', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ elements: [
    { type: 'node', id: 1, tags: { name: 'Bodega de pruebas', website: 'bodega.example.test', phone: '+34 978 000 111', email: 'info@bodega.example.test', owner: 'Persona privada' } },
    { type: 'way', id: 2, tags: { name: 'Otra empresa', 'contact:website': 'https://otra.example.test', 'contact:phone': '978000222', 'contact:email': 'persona@gmail.com', 'contact:mobile': '666000000' } },
    { type: 'node', id: 3, tags: { phone: '978111111' } },
  ] })));
  const candidates = await new OpenStreetMapAdapter({ fetcher, gate: fakeGate() }).search(criteria);
  expect(candidates).toHaveLength(2); expect(candidates[0]).toMatchObject({ sourceRef: 'node/1', website: 'https://bodega.example.test/', corporateEmail: 'info@bodega.example.test', attribution: osmAttribution });
  expect(candidates[1]).toMatchObject({ sourceRef: 'way/2', corporatePhone: '978000222', corporateEmail: null });
  expect(JSON.stringify(candidates)).not.toMatch(/Persona privada|persona@gmail|666000/);
  const options = fetcher.mock.calls[0][1]; expect(options.signal).toBeInstanceOf(AbortSignal); expect(options.headers['User-Agent']).toContain('try-comercial-bot');
  expect(new URLSearchParams(options.body).get('data')).toContain('[timeout:55]');
});
it.each([429, 504])('reintenta Overpass %s con espera y endpoint configurable', async status => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status })).mockResolvedValueOnce(new Response('{"elements":[]}'));
  const pause = vi.fn().mockResolvedValue(undefined);
  await new OpenStreetMapAdapter({ fetcher, pause, gate: fakeGate(), url: 'https://overpass.example.test/interpreter' }).search(criteria);
  expect(pause).toHaveBeenCalledWith(2000); expect(fetcher).toHaveBeenCalledTimes(2); expect(fetcher.mock.calls[0][0]).toBe('https://overpass.example.test/interpreter');
});
it('la puerta compartida nunca solapa peticiones y exige dos segundos entre ellas', async () => {
  const pause = vi.fn().mockResolvedValue(undefined); const gate = new OverpassGate(pause, () => 0);
  let active = 0; let max = 0;
  const run = () => gate.run(async () => { active++; max = Math.max(active, max); await Promise.resolve(); active--; });
  await Promise.all([run(), run(), run()]); expect(max).toBe(1); expect(pause.mock.calls).toEqual([[2000], [2000]]);
});
it('rechaza resultados parciales con remark y no inventa empresas', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{"remark":"timeout","elements":[]}'));
  await expect(new OpenStreetMapAdapter({ fetcher, gate: fakeGate() }).search(criteria)).rejects.toThrow('OVERPASS_RESPONSE_INVALID');
});
