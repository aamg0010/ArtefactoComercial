import { PrismaClient, TaskStatus } from '@prisma/client';
import { setCompanyCadenceStatus } from './cadence';
import { isSuppressed } from './suppression';
import { enqueue, enqueueCompany, enqueuePipeline } from './trygestion/outbox';
import { normalizeDomain } from './normalization';
import { safeId } from './mi-dia/script-email';
import { companyInScope, taskInScope } from './guia/engine';

export async function completeTask(prisma: PrismaClient, taskId: string, result: string, authorId?: string, meeting?: { date: string; time: string; location?: string }) {
  safeId.parse(taskId);
  if (!['Contactado', 'No contesta', 'Buzón', 'Interesado', 'Reunión agendada', 'No interesado', 'Baja'].includes(result)) throw new Error('Resultado inválido');
  return prisma.$transaction(async (tx) => {
    const before = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${before.companyId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${taskId} FOR UPDATE`;
    const current = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
    const company = await tx.company.findUniqueOrThrow({ where: { id: current.companyId } });
    if (authorId) {
      const user = await tx.user.findUniqueOrThrow({ where: { id: safeId.parse(authorId) } });
      const scope = { userId: user.id, role: user.role, team: user.role === 'ADMIN' };
      if (user.role === 'DIRECTOR' || !companyInScope(company, scope) || !taskInScope(current, scope)) throw new Error('No autorizado');
    }
    if (current.status !== 'PENDING') return current;
    if (company.acceptanceStatus !== 'ACCEPTED') throw new Error('Empresa pendiente de aceptar o descartada.');
    const task = await tx.task.update({ where: { id: taskId }, data: { status: TaskStatus.COMPLETED, completedAt: new Date(), result }, include: { companyCadence: true, cadenceStep: true } });
    const activity = await tx.activity.create({ data: { companyId: task.companyId, taskId: task.id, authorId, type: task.type === 'CALL' ? 'CALL' : task.type === 'FOLLOW_UP' ? 'NOTE' : 'EMAIL', result } });
    await enqueueCompany(tx, company.id);
    await enqueue(tx, 'ACTIVITY', activity.id, { companyId: company.id });
    if (result === 'Reunión agendada' && meeting) await enqueue(tx, 'EVENT', activity.id, { companyId: company.id, event: { titulo: `Reunión con ${company.name}`, descripcion: task.title, fecha_inicio: meeting.date, fecha_fin: meeting.date, hora: meeting.time, tipo: 'reunion', ambito: 'externo', ubicacion: meeting.location ?? '', entidad_externa: company.name } });
    if (result === 'Baja') {
      const contacts = await tx.contact.findMany({ where: { companyId: company.id } });
      await enqueue(tx, 'SUPPRESSION', company.id, { companyId: company.id, emails: [company.email, ...contacts.map(contact => contact.email)].filter(Boolean), domains: [normalizeDomain(company.website)].filter(Boolean), motivo: 'Baja solicitada' }, activity.id);
    }
    const stage = result === 'Reunión agendada' ? 'MEETING' : result === 'No interesado' ? 'LOST' : ['Contactado', 'Interesado'].includes(result) ? 'CONTACTING' : undefined; if (stage) await tx.company.update({ where: { id: task.companyId }, data: { pipelineStage: stage } });
    if (stage) await enqueuePipeline(tx, company.id, stage, activity.id, result);
    if (result === 'Baja') { const suppressed = await tx.suppressionList.findFirst({ where: { companyId: task.companyId } }); if (suppressed) await tx.suppressionList.update({ where: { id: suppressed.id }, data: { reason: 'Baja solicitada' } }); else await tx.suppressionList.create({ data: { companyId: task.companyId, reason: 'Baja solicitada' } }); await tx.task.updateMany({ where: { companyId: task.companyId, status: 'PENDING' }, data: { status: 'CANCELLED' } }); if (task.companyCadence) await setCompanyCadenceStatus(tx, task.companyCadence.id, 'PAUSED', task.id); return task; }
    if (['Interesado', 'Reunión agendada', 'No interesado'].includes(result) && task.companyCadence) { await setCompanyCadenceStatus(tx, task.companyCadence.id, result === 'No interesado' ? 'FINISHED' : 'PAUSED', task.id); return task; }
    if (task.companyCadence?.status === 'ACTIVE' && task.cadenceStep && !await isSuppressed(tx, task.companyId)) { const next = await tx.cadenceStep.findFirst({ where: { cadenceId: task.companyCadence.cadenceId, dayOffset: { gt: task.cadenceStep.dayOffset } }, orderBy: { dayOffset: 'asc' } }); if (next) await tx.task.upsert({ where: { companyId_cadenceStepId: { companyId: task.companyId, cadenceStepId: next.id } }, update: {}, create: { companyId: task.companyId, companyCadenceId: task.companyCadence.id, cadenceStepId: next.id, scriptId: task.companyCadence.scriptId, type: next.type, title: next.action, dueAt: new Date(task.companyCadence.startDate.getTime() + (next.dayOffset - 1) * 86400000) } }); }
    return task;
  });
}
