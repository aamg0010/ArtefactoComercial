import { expect, it } from 'vitest';
import { isSafeTestDatabase } from './test-database';

const url = 'postgresql://try:try@localhost:54329/try_comercial_test?schema=public';
it('permite una base de pruebas separada con sufijo _test', () => {
  expect(isSafeTestDatabase(url, url.replace('_test', ''))).toBe(true);
});
it('bloquea una URL de pruebas ausente, inválida o sin sufijo _test', () => {
  for (const value of [undefined, 'invalid', url.replace('_test', '')]) {
    expect(isSafeTestDatabase(value)).toBe(false);
  }
});
it('bloquea la base de trabajo incluso con parámetros diferentes', () => {
  expect(isSafeTestDatabase(url, url)).toBe(false);
  expect(isSafeTestDatabase(url, url.replace('public', 'other'))).toBe(false);
});
it('exige el sufijo _e2e y una base separada para Playwright', () => {
  const e2eUrl = url.replace('_test', '_e2e');
  expect(isSafeTestDatabase(e2eUrl, url, '_e2e')).toBe(true);
  expect(isSafeTestDatabase(url, undefined, '_e2e')).toBe(false);
  expect(isSafeTestDatabase(e2eUrl, e2eUrl, '_e2e')).toBe(false);
  expect(isSafeTestDatabase(e2eUrl, e2eUrl.replace('public', 'other'), '_e2e')).toBe(false);
});
