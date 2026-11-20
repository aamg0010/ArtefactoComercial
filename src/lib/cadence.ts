import { CompanyCadenceStatus, Prisma } from '@prisma/client';

export async function setCompanyCadenceStatus(tx: Prisma.TransactionClient, companyCadenceId: string, status: CompanyCadenceStatus, exceptTaskId?: string) {
  const cadence = await tx.companyCadence.update({ where: { id: companyCadenceId }, data: { status } });
  if (status === 'PAUSED' || status === 'FINISHED') await tx.task.updateMany({ where: { companyCadenceId, status: 'PENDING', ...(exceptTaskId ? { id: { not: exceptTaskId } } : {}) }, data: { status: 'CANCELLED' } });
  return cadence;
}
