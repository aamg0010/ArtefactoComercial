import { expect, it } from 'vitest';
import { duplicateReason, normalizedBusinessName, normalizedPhone } from './deduplication';

it.each(['Árbol S.L.', 'Árbol S. A.', 'Arbol S.A.U.', 'Árbol S. Coop.', 'Árbol Sociedad Cooperativa', 'Sociedad Cooperativa Árbol', 'Árbol Sociedad Limitada'])('normaliza acentos y la forma jurídica de %s', name => {
  expect(normalizedBusinessName(name)).toBe('arbol');
  expect(duplicateReason({ name, city: 'Alcañiz', country: 'ES' }, { name: 'Arbol', city: 'Alcaniz', country: 'ES' })).toBe('NAME_CITY');
});
it('distingue municipios y países distintos', () => {
  expect(duplicateReason({ name: 'Empresa S.L.', city: 'Caspe', country: 'ES' }, { name: 'Empresa SA', city: 'Calanda', country: 'ES' })).toBeNull();
  expect(duplicateReason({ name: 'Empresa', city: 'Caspe', country: 'ES' }, { name: 'Empresa', city: 'Caspe', country: 'CO' })).toBeNull();
});
it('deduplica por NIF y por dominio con o sin www', () => {
  expect(duplicateReason({ name: 'Uno', city: '', country: 'ES', nifNit: 'b-123' }, { name: 'Dos', city: '', country: 'ES', nifNit: 'B123' })).toBe('NIF');
  expect(duplicateReason({ name: 'Uno', city: '', country: 'ES', website: 'https://www.empresa.test/a' }, { name: 'Dos', city: '', country: 'ES', website: 'http://empresa.test' })).toBe('DOMAIN');
});
it('place_id sólo coincide dentro de su misma fuente', () => {
  const candidate = { name: 'Uno', city: 'A', country: 'ES', source: 'google-places', sourceRef: 'ChIJ-test' };
  const stored = { name: 'Dos', city: 'B', country: 'ES', sourceIdentities: [{ source: 'google-places', sourceRef: 'ChIJ-test' }] };
  expect(duplicateReason(candidate, stored)).toBe('SOURCE_REF');
  expect(duplicateReason({ ...candidate, source: 'csv' }, stored)).toBeNull();
});
it('normaliza teléfonos españoles e internacionales para la exclusión', () => {
  expect(normalizedPhone('976 632 132', 'ES')).toBe(normalizedPhone('+34 976632132', 'ES'));
  expect(normalizedPhone('0034 976632132', 'ES')).toBe('34976632132');
});
