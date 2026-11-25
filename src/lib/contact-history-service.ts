import type { PrismaClient } from '@prisma/client';
import { safeId } from './mi-dia/script-email';
import { buildContactHistory } from './contact-history';

export async function loadContactHistory(db: PrismaClient, companyId: string, medium = 'Todos') {
  safeId.parse(companyId);
  const [activities, dispatches, replies, tasks, cadences] = await Promise.all([
    db.activity.findMany({ where: { companyId }, include: { author: true } }),
    db.emailDispatch.findMany({ where: { companyId }, include: { approver: true } }),
    db.emailReply.findMany({ where: { companyId }, include: { handledBy: true } }),
    db.task.findMany({ where: { companyId }, select: { id: true } }),
    db.companyCadence.findMany({ where: { companyId }, select: { id: true } }),
  ]);
  const audits = await db.auditLog.findMany({ where: { OR: [{ entityType: 'Company', entityId: companyId }, { entityType: 'Task', entityId: { in: tasks.map(t => t.id) } }, { entityType: 'CompanyCadence', entityId: { in: cadences.map(c => c.id) } }] }, include: { user: true } });
  // Fecha real en que se empezó a guardar el texto de los emails: cuando Prisma aplicó la migración en este entorno.
  // (No se guarda en Template: esa tabla son las plantillas que se envían a la IA al generar guiones.)
  const [activation] = await db.$queryRaw<{ finished_at: Date | null }[]>`SELECT finished_at FROM _prisma_migrations WHERE migration_name = '20261125190000_contact_history' AND finished_at IS NOT NULL LIMIT 1`.catch(() => []);
  return buildContactHistory({ activities, dispatches, replies, audits }, medium, activation?.finished_at ?? undefined);
}
