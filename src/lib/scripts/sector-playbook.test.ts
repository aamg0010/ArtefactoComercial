import { expect, it } from 'vitest';
import { detectSector, sectorPlaybooks } from './sector-playbook';

it.each([
  ['Bodegas Borsao', 'Bodega DOP Campo de Borja', 'vino'],
  ['La Monrealense Industria Cárnica', '', 'alimentacion'],
  ['TRANSPORTES MARCO CB', '', 'transporte'],
  ['Suministros Cumar Alcañiz', '', 'suministros'],
  ['Cristalería Alcorisa', '', 'construccion'],
  ['Macana Fish S.L.', '', 'alimentacion'],
])('detecta el sector de %s', (name, sector, expected) => expect(detectSector({ name, sector })).toBe(expected));
it('detecta por códigos y mantiene un manual sin dígitos ni retos afirmativos', () => {
  expect(detectSector({ codes: ['1102'] })).toBe('vino');
  expect(detectSector({ codes: ['4941'] })).toBe('transporte');
  expect(detectSector({ codes: ['0113'] })).toBe('agro');
  expect(detectSector({})).toBe('general');
  expect(JSON.stringify(sectorPlaybooks)).not.toMatch(/\d/);
  for (const m of Object.values(sectorPlaybooks)) {
    expect(m.retos.length).toBeGreaterThanOrEqual(4);
    expect(m.retos.length).toBeLessThanOrEqual(6);
    expect(m.retos.every(q => q.startsWith('¿') && q.endsWith('?'))).toBe(true);
  }
});
