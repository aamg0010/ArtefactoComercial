import { madridDate, taskDate } from '../dates';

export const STALLED_DAYS = 14;
export const REMINDER_TITLE = 'Retomar contacto (90 días)';
export const FOLLOWING_STAGES = ['CONTACTING', 'MEETING', 'PROPOSAL', 'NEGOTIATION'];
export const POSITIVE_RESULTS = ['Interesado', 'Reunión agendada', 'Contactado'];
export const GROUPS = [
  ['replies', 'Respuestas de clientes sin gestionar'], ['overdue', 'Vencidas'], ['today', 'Hoy'],
  ['next', 'En seguimiento sin próximo paso'], ['stalled', 'Paradas'], ['closed', 'Ciclos cerrados sin respuesta'],
  ['reminders', 'Recordatorios de 90 días'], ['tomorrow', 'Mañana'], ['prepare', 'Pendientes de preparar'],
] as const;
export type GroupId = typeof GROUPS[number][0];
export type Scope = { userId: string; role: string; team?: boolean };
export type GuideTask = { id: string; title: string; type: string; status: string; assigneeId: string | null; dueAt: Date | null; completedAt: Date | null; result: string | null; companyCadenceId: string | null; cadenceStep: { dayOffset: number; action: string } | null };
export type GuideCompany = {
  id: string; name: string; ownerId: string | null; acceptanceStatus: string; pipelineStage: string; createdAt: Date;
  tasks: GuideTask[]; activities: { createdAt: Date; result: string | null }[];
  emailReplies: { id: string; status: string; subject: string; receivedAt: Date }[];
  cadences: { id: string; status: string }[]; researchReports: { id: string }[]; scripts: { status: string }[];
  suppressions: { id: string }[];
};
export type Notice = { id: string; companyId?: string; companyName: string; title: string; reason: string; taskId?: string; cadenceId?: string; dueDay?: string };
export const addDays = (day: string, amount: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + amount * 86400000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
/**
 * Una empresa es del usuario si es su propietario, si no tiene propietario o si el usuario tiene tareas asignadas en ella
 * (en producción las empresas de la carga inicial pertenecen al administrador del seed, pero sus tareas son de cada comercial).
 */
export const companyInScope = (company: { ownerId: string | null; tasks?: { assigneeId: string | null }[] }, scope: Scope) =>
  Boolean(scope.team) || !company.ownerId || company.ownerId === scope.userId || Boolean(company.tasks?.some(task => task.assigneeId === scope.userId));
export const taskInScope = (task: { assigneeId: string | null }, scope: Scope) => Boolean(scope.team) || !task.assigneeId || task.assigneeId === scope.userId;
export function closedCycle(company: GuideCompany, cadenceId: string) {
  const cadence = company.cadences.find(c => c.id === cadenceId);
  if (!cadence || cadence.status === 'PAUSED' || company.acceptanceStatus !== 'ACCEPTED' || company.suppressions.length || ['WON', 'LOST'].includes(company.pipelineStage)) return null;
  if (company.emailReplies.length || company.activities.some(a => POSITIVE_RESULTS.includes(a.result ?? '')) || company.tasks.some(t => POSITIVE_RESULTS.includes(t.result ?? ''))) return null;
  return company.tasks.filter(t => t.companyCadenceId === cadenceId && t.cadenceStep?.dayOffset === 15 && t.type === 'EMAIL' && t.status === 'COMPLETED' && t.completedAt).sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime())[0]?.completedAt ?? null;
}
/** Pure calculation: dueAt is a UTC business date; event instants use Europe/Madrid. */
export function buildGuide(companies: readonly GuideCompany[], scope: Scope, now = new Date(), day = madridDate(now), orphanReplies: { id: string; subject: string }[] = []) {
  const groups = GROUPS.map(([id, title]) => ({ id, title, items: [] as Notice[], count: 0 }));
  const push = (id: GroupId, item: Notice) => groups.find(g => g.id === id)!.items.push(item);
  const preparation = { research: 0, script: 0, approval: 0 };
  for (const company of companies.filter(c => companyInScope(c, scope))) {
    const base = { companyId: company.id, companyName: company.name };
    for (const reply of company.emailReplies.filter(r => r.status === 'NEW' && madridDate(r.receivedAt) <= day)) push('replies', { ...base, id: reply.id, title: reply.subject, reason: 'Respuesta pendiente de gestionar' });
    if (company.acceptanceStatus !== 'ACCEPTED' || company.suppressions.length) continue;
    const pending = company.tasks.filter(t => t.status === 'PENDING');
    for (const task of pending.filter(t => taskInScope(t, scope))) {
      const date = taskDate(task.dueAt);
      if (!date) continue;
      const reminder = task.title === REMINDER_TITLE && Boolean(task.companyCadenceId);
      const group = reminder && date <= day ? 'reminders' : date < day ? 'overdue' : date === day ? 'today' : date === addDays(day, 1) ? 'tomorrow' : null;
      if (group) push(group, { ...base, id: task.id, taskId: task.id, dueDay: date,
        title: task.cadenceStep ? `Día ${task.cadenceStep.dayOffset} · ${task.cadenceStep.action.split(';')[0]}` : task.title,
        reason: date < day ? `Vencida hace ${daysBetween(date, day)} días` : task.cadenceStep ? `Día ${task.cadenceStep.dayOffset} de la cadencia` : reminder ? 'Han pasado 90 días: retomar contacto' : group === 'tomorrow' ? 'Vista previa para mañana' : 'Programada para hoy' });
    }
    if (FOLLOWING_STAGES.includes(company.pipelineStage)) {
      if (!pending.length) push('next', { ...base, id: company.id, title: 'Crear siguiente paso', reason: 'Empresa en seguimiento sin ninguna tarea pendiente' });
      const last = Math.max(company.createdAt.getTime(), ...company.activities.map(a => a.createdAt.getTime()), ...company.tasks.filter(t => t.status === 'COMPLETED' && t.completedAt).map(t => t.completedAt!.getTime()));
      const elapsed = daysBetween(madridDate(new Date(last)), day);
      if (elapsed >= STALLED_DAYS) push('stalled', { ...base, id: company.id, title: 'Revisar seguimiento', reason: `Sin actividad desde hace ${elapsed} días` });
    }
    for (const cadence of company.cadences) {
      const closed = closedCycle(company, cadence.id);
      if (closed && madridDate(closed) <= day) push('closed', { ...base, id: cadence.id, cadenceId: cadence.id, title: 'Poner en pausa y recordar en 90 días', reason: 'Día 15 completado sin respuesta ni resultado positivo' });
    }
    if (!company.researchReports.length) preparation.research++;
    else if (!company.scripts.length) preparation.script++;
    else if (!company.scripts.some(s => s.status === 'APPROVED')) preparation.approval++;
  }
  for (const reply of orphanReplies) push('replies', { id: reply.id, companyName: 'Sin empresa vinculada', title: reply.subject, reason: 'Respuesta pendiente de vincular y gestionar' });
  for (const group of groups) {
    group.items.sort((a, b) => (a.dueDay ?? '').localeCompare(b.dueDay ?? '') || a.companyName.localeCompare(b.companyName, 'es') || a.id.localeCompare(b.id));
    group.count = group.id === 'prepare' ? Object.values(preparation).reduce((a, b) => a + b, 0) : group.items.length;
  }
  return { day, groups, preparation, important: groups.filter(g => ['replies', 'overdue', 'next', 'closed', 'reminders'].includes(g.id)).reduce((sum, g) => sum + g.count, 0) };
}
