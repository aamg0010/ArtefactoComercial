import { CompanyCadenceStatus, PrismaClient } from '@prisma/client';

export async function setCompanyCadenceStatus(prisma: PrismaClient, companyCadenceId: string, status: CompanyCadenceStatus) {
  return prisma.$transaction(async (tx) => {
    const cadence = await tx.companyCadence.update({ where: { id: companyCadenceId }, data: { status } });
    if (status === 'PAUSED' || status === 'FINISHED') {
      await tx.task.updateMany({ where: { companyCadenceId, status: 'PENDING', dueAt: { gt: new Date() } }, data: { status: 'CANCELLED' } });
    }
    return cadence;
  });
}
