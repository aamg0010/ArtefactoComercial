import { expect, it } from 'vitest';
import { filtersSchema, filterTasks, productLines, validDay } from './filters';
const day = '2026-11-24';
const task = (id: string, date: string | null, name: string, priority: string | null, country = 'ES', type = 'EMAIL') => ({
  id, title: 'Revisión comercial', dueAt: date ? new Date(`${date}T00:00:00Z`) : null, type,
  company: { name, priority, country, city: 'Alcañiz', region: 'Aragón', opportunities: [{ product: { line: 'Athenea' } }] }, script: null,
});
const tasks = [task('c', null, 'Zaragoza', null), task('b', day, 'Ávila', 'B', 'CO', 'CALL'), task('a', '2026-11-23', 'Bodega', 'A'), task('d', '2026-12-01', 'Casa', 'C'), task('e', '2026-12-02', 'Extra', 'B', 'ES', 'FOLLOW_UP')];
const ids = (raw: unknown, source = tasks) => filterTasks(source, filtersSchema.parse(raw), day).map(t => t.id);
it.each(['alcaniz', 'ARAGON', 'revision', 'avila'])('busca sin tildes ni mayúsculas: %s', buscar => {
  expect(ids({ buscar })).toEqual(buscar === 'avila' ? ['b'] : ['a', 'b', 'd', 'e', 'c']);
});
it('combina tipo, prioridad y país', () => {
  expect(ids({ tipo: 'EMAIL', prioridad: 'A', pais: 'ES' })).toEqual(['a']);
  expect(ids({ prioridad: 'NONE' })).toEqual(['c']);
  expect(ids({ pais: 'CO' })).toEqual(['b']);
  expect(ids({ tipo: 'FOLLOW_UP' })).toEqual(['e']);
});
it.each([['overdue', ['a']], ['today', ['b']], ['upcoming', ['d']], ['undated', ['c']]])('mostrar %s respeta los límites', (mostrar, expected) => expect(ids({ mostrar })).toEqual(expected));
it('ordena por fecha, prioridad y empresa sin modificar el original', () => {
  expect(ids({})).toEqual(['a', 'b', 'd', 'e', 'c']);
  expect(ids({ orden: 'priority' })).toEqual(['a', 'b', 'e', 'd', 'c']);
  expect(ids({ orden: 'company' })).toEqual(['b', 'a', 'd', 'e', 'c']);
  expect(tasks.map(t => t.id)).toEqual(['c', 'b', 'a', 'd', 'e']);
});
it('obtiene producto del guion y, en su ausencia, de oportunidades', () => {
  expect(ids({ producto: 'Athenea' })).toHaveLength(5);
  const withScript = { ...tasks[0], script: { content: { producto_principal: 'SaaS a medida' } } };
  expect(productLines(withScript)).toEqual(['SaaS a medida']);
  expect(filterTasks([withScript], filtersSchema.parse({ producto: 'Athenea' }), day)).toEqual([]);
});
it('tolera parámetros desconocidos, repetidos y fechas inválidas', () => {
  expect(ids({ tipo: 'MEETING', prioridad: 'X', pais: 'FR', mostrar: 'bad', orden: 'bad', buscar: ['dos'] })).toEqual(ids({}));
  expect(filtersSchema.parse({})).toEqual({ buscar: '', tipo: '', prioridad: '', pais: '', producto: '', mostrar: '', orden: 'date' });
  expect(validDay('2026-02-30')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(validDay('2026-02-30')).not.toBe('2026-02-30');
  expect(validDay(day)).toBe(day);
});
