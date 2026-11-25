import { describe, expect, it } from 'vitest';
import { buildContactHistory, contactHistoryCsv, historyDate } from './contact-history';

type Sources = Parameters<typeof buildContactHistory>[0];
// Fixtures representan también las columnas nulas de registros anteriores a la fase 12.
const sources = {
  activities: [{ id: 'call', type: 'CALL', createdAt: new Date('2026-11-25T10:00:00Z'), body: 'Hablamos\ncon compras', interlocutor: 'Ana', result: 'Contactado', author: { name: 'Andrés', email: 'a@test.invalid' } }, { id: 'meeting', type: 'MEETING', createdAt: new Date('2026-11-25T10:01:00Z'), body: 'Traer propuesta', meetingDetails: '2026-11-30 10:00', author: null }],
  dispatches: [{ taskId: 'old', sentAt: new Date('2026-11-20T08:00:00Z'), status: 'SENT', approvedBy: 'historico@test.invalid', body: null, approver: null }, { taskId: 'new', sentAt: new Date('2026-11-25T11:00:00Z'), status: 'SENT', recipient: 'info@test.invalid', subject: 'Propuesta', body: 'Hola "Ana";\nsegunda línea', signatureName: 'Andrés', signatureTitle: 'Gerente', approver: { name: 'Andrés' } }],
  replies: [{ id: 'reply', receivedAt: new Date('2026-11-25T12:00:00Z'), fromEmail: 'ana@test.invalid', subject: 'Re: Propuesta', summary: 'Interesada', excerpt: 'Llámame', status: 'HANDLED', handledAt: new Date('2026-11-25T13:00:00Z'), handledAction: 'seguimiento', handledBy: { name: 'Ana comercial' } }],
  audits: ['PIPELINE_STAGE', 'GUIDE_POSTPONE', 'GUIDE_PAUSE_90', 'CONTACT_WAIT_OVERRIDE'].map((action, i) => ({ id: action, action, createdAt: new Date(`2026-11-25T14:0${i}:00Z`), user: { name: 'Andrés' }, metadata: { from: 'CONTACTING', to: 'MEETING', days: 3, dueAt: '2027-02-23', action: 'SEND_EMAIL' } })),
} as unknown as Sources;
describe('historial de contactos', () => {
  it('fusiona las fuentes, ordena por instante y conserva usuario, texto y gestión', () => {
    const entries = buildContactHistory(sources, 'Todos', new Date('2026-11-25'));
    expect(entries).toHaveLength(9);
    expect(entries.map(e => e.at.getTime())).toEqual(entries.map(e => e.at.getTime()).sort((a,b) => b-a));
    expect(entries.at(-1)).toMatchObject({ text: 'Texto no guardado (enviado antes del 25/11/2026)', user: 'historico@test.invalid', status: 'Enviado' });
    expect(entries.find(e => e.medium === 'Llamada')).toMatchObject({ text: 'Hablamos\ncon compras', user: 'Andrés', address: 'Ana' });
    expect(entries.find(e => e.medium === 'Respuestas')?.text).toContain('25/11/2026 14:00 por Ana comercial · seguimiento');
    expect(buildContactHistory(sources, 'Email')).toHaveLength(2);
    expect(buildContactHistory(sources, 'Cambios')).toHaveLength(4);
    expect(buildContactHistory({ activities: [], dispatches: [], replies: [], audits: [] })).toEqual([]);
  });
  it('fecha y hora de Madrid con horario de invierno y verano', () => {
    expect(historyDate(new Date('2026-11-25T23:30:00Z'))).toEqual({ date: '26/11/2026', time: '00:30' });
    expect(historyDate(new Date('2026-07-25T23:30:00Z'))).toEqual({ date: '26/07/2026', time: '01:30' });
  });
  it('CSV Excel con ;, comillas, saltos de línea, firma y fórmulas neutralizadas', () => {
    const entries = buildContactHistory(sources, 'Email');
    const csv = contactHistoryCsv(entries);
    expect(csv.startsWith('\uFEFF"Fecha";"Hora"')).toBe(true);
    expect(csv).toContain('"Hola ""Ana"";\nsegunda línea\nAndrés · Gerente"');
    expect(csv).toContain('"25/11/2026";"12:00";"Email"');
    expect(contactHistoryCsv([{ ...entries[0], text: '=CMD()', signature: '', subject: '\t+formula' }])).toContain('"\'=CMD()"');
  });
});
