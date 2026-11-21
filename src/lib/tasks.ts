import { PrismaClient, TaskStatus } from '@prisma/client';
import { setCompanyCadenceStatus } from './cadence';
import { isSuppressed } from './suppression';

export async function completeTask(prisma: PrismaClient, taskId: string, result: string, authorId?: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.task.findUniqueOrThrow({ where: { id: taskId } }); if (current.status !== 'PENDING') throw new Error('La tarea ya fue procesada.');
    const task = await tx.task.update({ where: { id: taskId }, data: { status: TaskStatus.COMPLETED, completedAt: new Date(), result }, include: { companyCadence: true, cadenceStep: true } });
    await tx.activity.create({ data: { companyId: task.companyId, taskId: task.id, authorId, type: task.type === 'CALL' ? 'CALL' : task.type === 'FOLLOW_UP' ? 'NOTE' : 'EMAIL', result } });
    const stage = result === 'Reunión agendada' ? 'MEETING' : result === 'No interesado' ? 'LOST' : ['Contactado', 'Interesado'].includes(result) ? 'CONTACTING' : undefined; if (stage) await tx.company.update({ where: { id: task.companyId }, data: { pipelineStage: stage } });
    if (result === 'Baja') { const suppressed = await tx.suppressionList.findFirst({ where: { companyId: task.companyId } }); if (suppressed) await tx.suppressionList.update({ where: { id: suppressed.id }, data: { reason: 'Baja solicitada' } }); else await tx.suppressionList.create({ data: { companyId: task.companyId, reason: 'Baja solicitada' } }); await tx.task.updateMany({ where: { companyId: task.companyId, status: 'PENDING' }, data: { status: 'CANCELLED' } }); if (task.companyCadence) await setCompanyCadenceStatus(tx, task.companyCadence.id, 'PAUSED', task.id); return task; }
    if (['Interesado', 'Reunión agendada', 'No interesado'].includes(result) && task.companyCadence) { await setCompanyCadenceStatus(tx, task.companyCadence.id, result === 'No interesado' ? 'FINISHED' : 'PAUSED', task.id); return task; }
    if (task.companyCadence?.status === 'ACTIVE' && task.cadenceStep && !await isSuppressed(tx, task.companyId)) { const next = await tx.cadenceStep.findFirst({ where: { cadenceId: task.companyCadence.cadenceId, dayOffset: { gt: task.cadenceStep.dayOffset } }, orderBy: { dayOffset: 'asc' } }); if (next) await tx.task.upsert({ where: { companyId_cadenceStepId: { companyId: task.companyId, cadenceStepId: next.id } }, update: {}, create: { companyId: task.companyId, companyCadenceId: task.companyCadence.id, cadenceStepId: next.id, scriptId: task.companyCadence.scriptId, type: next.type, title: next.action, dueAt: new Date(task.companyCadence.startDate.getTime() + (next.dayOffset - 1) * 86400000) } }); }
    return task;
  });
}
