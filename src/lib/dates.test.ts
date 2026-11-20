import { describe, expect, it } from 'vitest';
import { madridDate, taskDate } from './dates';
describe('fechas de Mi día', () => { it('a las 00:30 de Madrid conserva la fecha de negocio UTC', () => { expect(madridDate(new Date('2026-11-22T23:30:00.000Z'))).toBe('2026-11-23'); expect(taskDate(new Date('2026-11-23T00:00:00.000Z'))).toBe('2026-11-23'); }); });
