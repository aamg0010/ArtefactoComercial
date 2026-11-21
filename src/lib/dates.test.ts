import { describe, expect, it } from 'vitest';
import { madridDate, taskDate, madridDayBounds } from './dates';
describe('fechas de Mi día', () => { it('a las 00:30 de Madrid conserva la fecha de negocio UTC', () => { expect(madridDate(new Date('2026-11-22T23:30:00.000Z'))).toBe('2026-11-23'); expect(taskDate(new Date('2026-11-23T00:00:00.000Z'))).toBe('2026-11-23'); }); });
it('Detectadas hoy usa los límites reales de Madrid incluso con cambio de horario', () => {
  const winter = madridDayBounds('2026-11-23'); expect(winter.start.toISOString()).toBe('2026-11-22T23:00:00.000Z');
  const change = madridDayBounds('2026-10-25'); expect(change.end.getTime() - change.start.getTime()).toBe(25 * 3_600_000);
});
