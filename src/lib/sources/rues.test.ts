import { expect, it, vi } from 'vitest';
import { RuesAdapter, ruesChambers } from './rues';
import { CITY_PENDING } from './einforma';
import { sourceAdapter } from './index';
import type { SearchCriteria } from './types';

const criteria: SearchCriteria = { country: 'CO', provinces: ['Córdoba'], comarcas: [], municipalities: ['Montería'], keywords: ['ganadera'], cnaeCodes: ['0141'], productLine: 'Ganadex', maxResults: 5 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const row = (matricula: string, razon_social: string, extra: object = {}) => ({
  codigo_camara: '22', camara_comercio: 'MONTERIA', matricula, razon_social, nit: `90${matricula}`, digito_verificacion: '7',
  cod_ciiu_act_econ_pri: '0141', ultimo_ano_renovado: '2026', representante_legal: 'PERSONA QUE NO SE GUARDA', ...extra,
});

it('traduce departamentos y ciudades sede a cámaras de comercio', () => {
  expect([...ruesChambers({ provinces: ['Antioquia'], municipalities: [] }).keys()]).toEqual(['MEDELLIN PARA ANTIOQUIA', 'ABURRA SUR', 'ORIENTE ANTIOQUENO', 'URABA', 'MAGDALENA MEDIO']);
  expect([...ruesChambers({ provinces: ['Bogotá D.C.'], municipalities: ['Medellín'] }).entries()]).toEqual([['BOGOTA', 'Bogotá D.C.'], ['MEDELLIN PARA ANTIOQUIA', 'Antioquia']]);
  expect(ruesChambers({ provinces: ['Teruel'], municipalities: ['Alcañiz'] }).size).toBe(0);
});

it('consulta solo sociedades activas y renovadas de las cámaras del perfil, por CIIU o razón social, y no guarda datos personales', async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL) => json([row('1', 'AGROGANADERA EBENEZER S.A.S'), row('2', 'HACIENDA LA PRIMAVERA SAS', { cod_ciiu_act_econ_pri: '0144' })]));
  const found = await new RuesAdapter({ fetcher, now: () => new Date('2026-11-23') }).search(criteria);
  const where = new URL(String(fetcher.mock.calls[0][0])).searchParams.get('$where')!;
  expect(where).toContain("camara_comercio in ('MONTERIA')");
  expect(where).toContain("estado_matricula = 'ACTIVA'");
  expect(where).toContain("organizacion_juridica != 'PERSONA NATURAL'");
  expect(where).toContain("ultimo_ano_renovado >= '2025'");
  expect(where).toContain("starts_with(cod_ciiu_act_econ_pri, '0141') OR upper(razon_social) like '%GANADERA%'");
  expect(found).toHaveLength(2);
  expect(found[0]).toMatchObject({ name: 'AGROGANADERA EBENEZER S.A.S', city: CITY_PENDING, province: 'Córdoba', country: 'CO', nif: '901-7', category: 'ganadera', source: 'rues', sourceRef: '22-1' });
  expect(found[1]).toMatchObject({ category: 'CIIU 0144', attribution: 'RUES · Cámara de Comercio de Monteria' });
  expect(JSON.stringify(found)).not.toContain('PERSONA QUE NO SE GUARDA');
});

it('salta las empresas que ya trajo antes y pagina hasta completar el máximo', async () => {
  const pages = [Array.from({ length: 200 }, (_, index) => row(String(index), `GANADERA ${index} SAS`)), [row('900', 'GANADERA NUEVA SAS')]];
  const fetcher = vi.fn(async (input: RequestInfo | URL) => json(pages[Number(new URL(String(input)).searchParams.get('$offset')) / 200] ?? []));
  const known = new Set(Array.from({ length: 200 }, (_, index) => `22-${index}`));
  const found = await new RuesAdapter({ fetcher, knownRefs: async () => known }).search({ ...criteria, maxResults: 3 });
  expect(found.map(item => item.sourceRef)).toEqual(['22-900']);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('errores claros: España, sin departamento reconocido y servicio saturado', async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL) => json({ message: 'busy' }, 503));
  await expect(new RuesAdapter({ fetcher }).search({ ...criteria, country: 'ES' })).rejects.toMatchObject({ code: 'RUES_ONLY_COLOMBIA' });
  await expect(new RuesAdapter({ fetcher }).search({ ...criteria, provinces: ['Teruel'], municipalities: ['Alcañiz'] })).rejects.toMatchObject({ code: 'RUES_NO_CHAMBER' });
  await expect(new RuesAdapter({ fetcher }).search(criteria)).rejects.toMatchObject({ code: 'RUES_HTTP_503' });
  expect(sourceAdapter('rues').id).toBe('rues');
});
