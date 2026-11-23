import { expect, it } from 'vitest';
import { productCatalog } from './catalog';

it('el catálogo incluye SaaS a medida, sin líneas repetidas y con descripción para la IA', () => {
  const lines = productCatalog.map(item => item.line);
  expect(lines).toEqual(expect.arrayContaining(['Ganadex', 'trygestión', 'Athenea', 'SaaS a medida', 'Bots / IA', 'Ciberseguridad']));
  expect(new Set(lines).size).toBe(lines.length);
  expect(productCatalog.every(item => item.description.length >= 10)).toBe(true);
  // La IA no puede poner cifras que no estén en la ficha: las descripciones no llevan números.
  expect(productCatalog.some(item => /\d/.test(item.description))).toBe(false);
});
