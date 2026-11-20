import { PrismaClient, TaskStatus } from '@prisma/client';
import { setCompanyCadenceStatus } from './cadence';

export async function completeTask(prisma: PrismaClient, taskId: string, result: string, authorId?: string) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.update({ where: { id: taskId }, data: { status: TaskStatus.COMPLETED, completedAt: new Date(), result }, include: { companyCadence: true, cadenceStep: true } });
    await tx.activity.create({ data: { companyId: task.companyId, taskId: task.id, authorId, type: task.type === 'CALL' ? 'CALL' : 'EMAIL', result } });
    if (result === 'Baja') { await tx.suppressionList.create({ data: { companyId: task.companyId, reason: 'Baja solicitada' } }); if (task.companyCadence) await setCompanyCadenceStatus(tx as unknown as PrismaClient, task.companyCadence.id, 'PAUSED'); return task; }
    if (['Interesado', 'Reunión agendada', 'No interesado'].includes(result) && task.companyCadence) { await setCompanyCadenceStatus(tx as unknown as PrismaClient, task.companyCadence.id, result === 'No interesado' ? 'FINISHED' : 'PAUSED'); return task; }
    if (task.companyCadence && task.cadenceStep) { const next = await tx.cadenceStep.findFirst({ where: { cadenceId: task.companyCadence.cadenceId, dayOffset: { gt: task.cadenceStep.dayOffset } }, orderBy: { dayOffset: 'asc' } }); if (next) await tx.task.upsert({ where: { companyId_cadenceStepId: { companyId: task.companyId, cadenceStepId: next.id } }, update: {}, create: { companyId: task.companyId, companyCadenceId: task.companyCadence.id, cadenceStepId: next.id, scriptId: task.companyCadence.scriptId, type: next.type, title: next.action, dueAt: new Date(task.companyCadence.startDate.getTime() + (next.dayOffset - 1) * 86400000) } }); }
    return task;
  });
}
