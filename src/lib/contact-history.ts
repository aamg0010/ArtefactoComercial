import type { Activity, EmailDispatch, EmailReply, AuditLog, User } from '@prisma/client';

type Person = Pick<User, 'name' | 'email'> | null;
export const historyMedia = ['Todos', 'Email', 'Llamada', 'Reunión', 'Respuestas', 'Cambios'] as const;
export type HistoryEntry = { id: string; at: Date; medium: string; status: string; address: string; subject: string; text: string; user: string; signature?: string };
const person = (user: Person, fallback = 'Usuario no registrado') => user?.name || user?.email || fallback;
export function historyDate(at: Date) {
  const parts = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (key: string) => parts.find(p => p.type === key)!.value;
  return { date: `${get('day')}/${get('month')}/${get('year')}`, time: `${get('hour')}:${get('minute')}` };
}
export const auditLabels: Record<string, string> = { PIPELINE_STAGE: 'Cambio de etapa', GUIDE_POSTPONE: 'Tarea pospuesta', GUIDE_PAUSE_90: 'Pausa de 90 días', CONTACT_WAIT_OVERRIDE: 'Contactar igualmente' };
export function buildContactHistory(sources: {
  activities: (Activity & { author: Person })[];
  dispatches: (EmailDispatch & { approver: Person })[];
  replies: (EmailReply & { handledBy: Person })[];
  audits: (AuditLog & { user: Person })[];
}, medium = 'Todos', deployedAt?: Date): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const d of sources.dispatches) entries.push({ id: `email-${d.taskId}`, at: d.sentAt ?? d.updatedAt, medium: 'Email', status: ({ SENT: 'Enviado', FAILED: 'Fallido', PROCESSING: 'En proceso' }[d.status] ?? d.status) + (d.lastError ? ` · ${d.lastError}` : ''), address: d.recipient ?? '', subject: d.subject ?? '', text: d.body ?? `Texto no guardado (enviado antes del ${deployedAt ? historyDate(deployedAt).date : 'despliegue de la fase 12'})`, user: person(d.approver, d.approvedBy), signature: [d.signatureName, d.signatureTitle].filter(Boolean).join(' · ') });
  for (const a of sources.activities) {
    // La confirmación de resultado del email sigue siendo una actividad distinta del envío.
    entries.push({ id: `activity-${a.id}`, at: a.createdAt, medium: ({ CALL: 'Llamada', EMAIL: 'Email', MEETING: 'Reunión', NOTE: 'Cambios' }[a.type]), status: a.result ?? '', address: a.interlocutor ?? '', subject: a.type === 'EMAIL' ? 'Resultado de tarea de email' : '', text: [a.body, a.meetingDetails].filter(Boolean).join('\n'), user: person(a.author) });
    if (a.result === 'Reunión agendada' && a.type !== 'MEETING') entries.push({ id: `meeting-${a.id}`, at: a.createdAt, medium: 'Reunión', status: 'Reunión agendada', address: a.interlocutor ?? '', subject: '', text: [a.body, a.meetingDetails].filter(Boolean).join('\n'), user: person(a.author) });
  }
  for (const r of sources.replies) entries.push({ id: `reply-${r.id}`, at: r.receivedAt, medium: 'Respuestas', status: r.status === 'NEW' ? 'Pendiente' : `Gestionada: ${r.handledAction ?? 'sin acción registrada'}`, address: r.fromEmail, subject: r.subject, text: [r.summary, r.excerpt, r.handledAt ? `Gestionada el ${historyDate(r.handledAt).date} ${historyDate(r.handledAt).time} por ${person(r.handledBy)} · ${r.handledAction}` : null].filter(Boolean).join('\n'), user: r.handledAt ? person(r.handledBy) : 'Cliente (entrada automática)' });
  for (const a of sources.audits) {
    if (!auditLabels[a.action]) continue;
    const m = (a.metadata ?? {}) as Record<string, unknown>;
    const text = a.action === 'PIPELINE_STAGE' ? `${m.from ?? 'Etapa anterior no registrada'} → ${m.to ?? ''}` : a.action === 'GUIDE_POSTPONE' ? `De ${m.from ?? 'sin fecha'} a ${m.to ?? ''} · ${m.days ?? ''} días` : a.action === 'GUIDE_PAUSE_90' ? `Recordatorio: ${m.dueAt ?? ''}` : `Confirmación de contactar igualmente · Acción: ${m.action ?? ''} · Último contacto: ${m.lastContact ?? ''} · Próximo: ${m.nextContact ?? ''}`;
    entries.push({ id: `audit-${a.id}`, at: a.createdAt, medium: 'Cambios', status: auditLabels[a.action], address: '', subject: '', text, user: person(a.user, 'Sistema (automático)') });
  }
  return entries.filter(e => medium === 'Todos' || e.medium === medium).sort((a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id));
}
export function contactHistoryCsv(entries: HistoryEntry[]) {
  // Neutraliza fórmulas de Excel, también en texto libre y nombres de usuarios.
  const cell = (value: string) => `"${(/^[\s]*[=+@-]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
  return '\uFEFF' + [['Fecha', 'Hora', 'Medio', 'Resultado/estado', 'Destinatario/remitente', 'Asunto', 'Texto', 'Usuario'], ...entries.map(e => { const d = historyDate(e.at); return [d.date, d.time, e.medium, e.status, e.address, e.subject, [e.text, e.signature].filter(Boolean).join('\n'), e.user]; })].map(row => row.map(cell).join(';')).join('\r\n');
}
