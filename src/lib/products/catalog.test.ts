import { expect, it } from 'vitest';
import { productCatalog, catalogDescription } from './catalog';

it('el catálogo incluye SaaS a medida, sin líneas repetidas y con descripción para la IA', () => {
  const lines = productCatalog.map(item => item.line);
  expect(lines).toEqual(expect.arrayContaining(['Ganadex', 'trygestión', 'Athenea', 'SaaS a medida', 'Bots / IA', 'Ciberseguridad']));
  expect(new Set(lines).size).toBe(lines.length);
  expect(productCatalog.every(item => item.description.length >= 10)).toBe(true);
  // La IA no puede poner cifras que no estén en la ficha: las descripciones no llevan números.
  expect(productCatalog.some(item => /\d/.test(item.description))).toBe(false);
});
it('solo las tres líneas autorizadas incluyen casos reales anónimos', () => {
  expect(productCatalog.filter(p => p.casos).map(p => p.line).sort()).toEqual(['Athenea', 'SaaS a medida', 'trygestión']);
  for (const p of productCatalog) {
    expect(catalogDescription(p)).toContain(p.description);
    if (p.casos) expect(catalogDescription(p)).toContain(p.casos);
    expect(p.casos ?? '').not.toMatch(/\d|Milián|Quílez/);
  }
});
