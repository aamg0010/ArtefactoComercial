import { historyDate } from './contact-history';
import { madridDate, taskDate } from './dates';
import { REMINDER_TITLE } from './guia/engine';

export type ContactColor = 'green' | 'amber' | 'red' | 'gray';
export type ContactStatus = { color: ContactColor; label: string; detail: string; lastContact: string | null; nextContact: string | null; lastContactDetail?: string; historyHref?: string };
export type ContactFacts = {
  acceptanceStatus: string; pipelineStage: string; suppressed: boolean;
  activities: { type: string; createdAt: Date; author?: { name: string | null; email: string } | null }[];
  tasks: { type: string; status: string; completedAt: Date | null; dueAt: Date | null; title: string; companyCadenceId?: string | null; cadenceStep?: { dayOffset: number; action: string } | null }[];
  cadences: { id: string; status: string }[];
  emailReplies: { status: string }[];
  sentEmails: Date[];
  sentEmailDetails?: { sentAt: Date | null; approvedBy: string; approver: { name: string | null; email: string } | null }[];
};
const shortDate = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
/** Event instants use Madrid; task dueAt is a UTC business date. No database or clock side effects. */
export function contactStatus(facts: ContactFacts, now = new Date()): ContactStatus {
  const today = madridDate(now);
  const evidence = [...facts.activities.map(a => ({ at: a.createdAt, medium: ({ CALL: 'Llamada', EMAIL: 'Email', MEETING: 'Reunión' } as Record<string, string>)[a.type], user: a.author?.name || a.author?.email || 'Usuario no registrado' })), ...(facts.sentEmailDetails ?? []).filter(e => e.sentAt).map(e => ({ at: e.sentAt!, medium: 'Email', user: e.approver?.name || e.approver?.email || e.approvedBy }))].filter(e => e.medium).sort((a,b) => b.at.getTime() - a.at.getTime())[0];
  const lastContactDetail = evidence ? `Último contacto: ${evidence.medium} el ${historyDate(evidence.at).date.slice(0, 5)} a las ${historyDate(evidence.at).time} por ${evidence.user}` : undefined;
  const instants = [...facts.activities.filter(a => ['CALL', 'EMAIL', 'MEETING'].includes(a.type)).map(a => a.createdAt),
    ...facts.tasks.filter(t => ['CALL', 'EMAIL'].includes(t.type) && t.status === 'COMPLETED' && t.completedAt).map(t => t.completedAt!), ...facts.sentEmails];
  const lastContact = instants.length ? madridDate(new Date(Math.max(...instants.map(d => d.getTime())))) : null;
  const pending = facts.tasks.filter(t => t.status === 'PENDING');
  const reminders = pending.filter(t => t.title === REMINDER_TITLE && facts.cadences.some(c => c.id === t.companyCadenceId && c.status === 'PAUSED'));
  const next = [...(reminders.length ? reminders : pending)].filter(t => t.dueAt).sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime())[0];
  const nextContact = next ? taskDate(next.dueAt) : null;
  const lastText = lastContact ? `Contactada el ${shortDate(lastContact)}` : 'Sin contacto registrado';
  const detail = `${lastText}${nextContact ? ` · Próximo contacto el ${shortDate(nextContact)} (${next?.cadenceStep ? `Día ${next.cadenceStep.dayOffset} · ${next.cadenceStep.action.split(';')[0]}` : next!.title})` : ' · Sin próximo contacto previsto'}`;
  const result = (color: ContactColor, label: string, text = detail): ContactStatus => ({ color, label, detail: text, lastContact, nextContact, ...(lastContactDetail ? { lastContactDetail } : {}) });
  if (facts.suppressed) return result('gray', 'No contactar', 'Tiene baja: no se puede contactar');
  if (facts.pipelineStage === 'WON') return result('gray', 'Cliente');
  if (facts.acceptanceStatus === 'DISCARDED' || facts.pipelineStage === 'LOST') return result('gray', 'No contactar', `Empresa ${facts.pipelineStage === 'LOST' ? 'perdida' : 'descartada'} · ${detail}`);
  if (facts.emailReplies.some(r => r.status === 'NEW')) return result('amber', 'Toca hoy', `Respuesta de cliente sin gestionar · ${detail}`);
  if (reminders.length && nextContact && nextContact <= today) return result('green', 'Por contactar', `Recordatorio de 90 días vencido · ${detail}`);
  if (pending.some(t => t.dueAt && taskDate(t.dueAt)! <= today)) return result('amber', 'Toca hoy');
  if (nextContact && (lastContact || reminders.length)) return result('red', 'Contactada · espera', reminders.length ? `En pausa hasta el ${shortDate(nextContact)} · ${detail}` : detail);
  if (lastContact) return result('amber', 'Contactada sin próximo paso');
  return result('green', 'Por contactar');
}
export function contactBarrier(status: ContactStatus, confirmed = false) {
  return { allowed: status.color !== 'gray' && (status.color !== 'red' || confirmed), requiresConfirmation: status.color === 'red', message: status.detail };
}
export class ContactBarrierError extends Error {
  constructor(public code: 'CONTACT_CONFIRMATION_REQUIRED' | 'CONTACT_BLOCKED', message: string) { super(message); }
}
