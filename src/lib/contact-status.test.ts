import { describe, expect, it } from 'vitest';
import { contactStatus, contactBarrier, type ContactFacts } from './contact-status';
import { REMINDER_TITLE } from './guia/engine';

const now = new Date('2026-11-25T12:00:00Z');
const facts = (extra: Partial<ContactFacts> = {}): ContactFacts => ({ acceptanceStatus: 'ACCEPTED', pipelineStage: 'CONTACTING', suppressed: false, activities: [], tasks: [], cadences: [], emailReplies: [], sentEmails: [], ...extra });
const call = { type: 'CALL', createdAt: new Date('2026-11-12T10:00:00Z') };
const task = (day: string | null, extra: Partial<ContactFacts['tasks'][number]> = {}): ContactFacts['tasks'][number] => ({ type: 'EMAIL', status: 'PENDING', title: 'Email de seguimiento', completedAt: null, dueAt: day ? new Date(day) : null, ...extra });
describe('semáforo de contacto', () => {
  it('sin contacto es verde y las notas no cuentan como contacto', () => {
    expect(contactStatus(facts(), now)).toMatchObject({ color: 'green', label: 'Por contactar', lastContact: null });
    expect(contactStatus(facts({ activities: [{ ...call, type: 'NOTE' }], tasks: [task('2026-11-26')] }), now).color).toBe('green');
  });
  it('cadencia activa futura es roja, con fechas y paso', () => {
    const status = contactStatus(facts({ activities: [call], tasks: [task('2026-11-30', { cadenceStep: { dayOffset: 6, action: 'Email de seguimiento; detalle' } })], cadences: [{ id: 'cadence', status: 'ACTIVE' }] }), now);
    expect(status).toMatchObject({ color: 'red', label: 'Contactada · espera', lastContact: '2026-11-12', nextContact: '2026-11-30' });
    expect(status.detail).toBe('Contactada el 12/11 · Próximo contacto el 30/11 (Día 6 · Email de seguimiento)');
  });
  it('elige el último contacto entre actividades, tareas completadas y envíos', () => {
    const status = contactStatus(facts({ activities: [call, { ...call, type: 'MEETING' }], tasks: [task(null, { type: 'CALL', status: 'COMPLETED', completedAt: new Date('2026-11-20') }), task('2026-12-01')], sentEmails: [new Date('2026-11-24T23:30:00Z')] }), now);
    expect(status).toMatchObject({ color: 'red', lastContact: '2026-11-25' });
  });
  it.each(['2026-11-25', '2026-11-20'])('tarea hoy o vencida %s es ámbar', day => {
    expect(contactStatus(facts({ tasks: [task(day)] }), now)).toMatchObject({ color: 'amber', label: 'Toca hoy' });
  });
  it('sin próximo paso es ámbar y las tareas canceladas no son próximo paso', () => {
    expect(contactStatus(facts({ activities: [call], tasks: [task('2026-12-01', { status: 'CANCELLED' })] }), now)).toMatchObject({ color: 'amber', label: 'Contactada sin próximo paso', nextContact: null });
  });
  it('respuesta nueva tiene prioridad sobre espera y pausa; gestionada no', () => {
    const company = facts({ activities: [call], tasks: [task('2026-12-01')], emailReplies: [{ status: 'NEW' }] });
    expect(contactStatus(company, now)).toMatchObject({ color: 'amber', label: 'Toca hoy', detail: expect.stringContaining('Respuesta de cliente sin gestionar') });
    expect(contactStatus({ ...company, emailReplies: [{ status: 'HANDLED' }] }, now).color).toBe('red');
  });
  it('pausa hasta recordatorio de 90 días; al vencer vuelve a verde', () => {
    const company = facts({ activities: [call], cadences: [{ id: 'pause', status: 'PAUSED' }], tasks: [task('2027-02-23', { title: REMINDER_TITLE, companyCadenceId: 'pause', type: 'FOLLOW_UP' })] });
    expect(contactStatus(company, now)).toMatchObject({ color: 'red', detail: expect.stringContaining('En pausa hasta el 23/02') });
    expect(contactStatus(company, new Date('2027-02-23T10:00:00Z'))).toMatchObject({ color: 'green', label: 'Por contactar', detail: expect.stringContaining('Recordatorio de 90 días vencido') });
  });
  it.each([
    [{ suppressed: true }, 'No contactar'], [{ pipelineStage: 'LOST' }, 'No contactar'],
    [{ pipelineStage: 'WON' }, 'Cliente'], [{ acceptanceStatus: 'DISCARDED' }, 'No contactar'],
  ] as const)('gris prevalece sobre respuestas y tareas: %j', (extra, label) => {
    expect(contactStatus(facts({ ...extra, emailReplies: [{ status: 'NEW' }], tasks: [task('2026-11-25')] }), now)).toMatchObject({ color: 'gray', label });
  });
  it('cambia de rojo a ámbar a medianoche de Madrid, también en verano', () => {
    for (const [day, before, after] of [['2026-11-26', '2026-11-25T22:59:00Z', '2026-11-25T23:00:00Z'], ['2026-07-26', '2026-07-25T21:59:00Z', '2026-07-25T22:00:00Z']]) {
      const company = facts({ activities: [call], tasks: [task(day)] });
      expect(contactStatus(company, new Date(before)).color).toBe('red');
      expect(contactStatus(company, new Date(after)).color).toBe('amber');
    }
  });
});
describe('barrera de contacto', () => {
  it('roja exige confirmación explícita', () => {
    const status = contactStatus(facts({ activities: [call], tasks: [task('2026-12-01')] }), now);
    expect(contactBarrier(status)).toMatchObject({ allowed: false, requiresConfirmation: true });
    expect(contactBarrier(status, true).allowed).toBe(true);
  });
  it('gris se bloquea incluso con confirmación', () => {
    const status = contactStatus(facts({ suppressed: true }), now);
    expect(contactBarrier(status, true)).toMatchObject({ allowed: false, message: 'Tiene baja: no se puede contactar' });
  });
  it('verde y ámbar no exigen confirmación', () => {
    for (const company of [facts(), facts({ tasks: [task('2026-11-25')] })]) expect(contactBarrier(contactStatus(company, now))).toMatchObject({ allowed: true, requiresConfirmation: false });
  });
});
