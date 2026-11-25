import type { PrismaClient, UserRole } from '@prisma/client';
import { z } from 'zod';
import { enqueue } from './trygestion/outbox';

export const COMPANY_DELETED_REASON = 'Eliminada en try! Comercial';
const recordId = z.string().min(1).max(191).regex(/^[\w-]+$/);

/** Sin red: el cierre remoto queda en la misma transacción que la auditoría y el borrado. */
export async function deleteCompany(db: PrismaClient, input: { companyId: string; confirmed: boolean; user: { id: string; role: UserRole } | null }) {
  if (!input.user?.id || input.user.role === 'DIRECTOR') throw new Error('No autorizado');
  const id = recordId.parse(input.companyId);
  if (!input.confirmed) throw new Error('Confirma el borrado definitivo');
  const userId = input.user.id;
  return db.$transaction(async tx => {
    // El worker mantiene este mismo bloqueo durante todo su lote, incluidas las llamadas remotas.
    // También serializa dos envíos simultáneos del formulario.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(48106)::text`;
    const company = await tx.company.findUnique({ where: { id }, include: {
      _count: { select: { contacts: true, tasks: true, activities: true } },
      contacts: { select: { id: true } }, tasks: { select: { id: true } }, activities: { select: { id: true } },
    } });
    if (!company) return { deleted: false as const };
    const entities = [id, ...company.contacts.map(c => c.id), ...company.tasks.map(t => t.id), ...company.activities.map(a => a.id)];
    await tx.syncOutbox.updateMany({ where: {
      status: { in: ['PENDING', 'PROCESSING', 'FAILED'] },
      kind: { notIn: ['SUPPRESSION', 'CONTACT_DELETE', 'OPPORTUNITY_CLOSE_DELETED'] },
      OR: [{ entityId: { in: entities } }, { payload: { path: ['companyId'], equals: id } }],
    }, data: { status: 'SKIPPED', lastError: null, payload: {} } });
    await tx.auditLog.create({ data: { userId, entityType: 'Company', entityId: id, action: 'COMPANY_DELETED', metadata: {
      name: company.name, nifNit: company.nifNit, website: company.website, city: company.city, country: company.country,
      pipelineStage: company.pipelineStage, priority: company.priority, counts: company._count,
      trygestionEmpresaId: company.trygestionEmpresaId, trygestionOportunidadId: company.trygestionOportunidadId,
    } } });
    if (company.trygestionOportunidadId) await enqueue(tx, 'OPPORTUNITY_CLOSE_DELETED', id, {
      trygestionOportunidadId: company.trygestionOportunidadId, motivo: COMPANY_DELETED_REASON,
    });
    // Sin FK o con SetNull: borrar textos e identidades que impedirían volver a importar.
    await tx.emailDispatch.deleteMany({ where: { OR: [{ companyId: id }, { taskId: { in: company.tasks.map(t => t.id) } }] } });
    await tx.emailReply.deleteMany({ where: { OR: [{ companyId: id }, { taskId: { in: company.tasks.map(t => t.id) } }] } });
    await tx.companySource.deleteMany({ where: { companyId: id } });
    // SuppressionList conserva email/teléfono/dominio y el resto de identificadores.
    await tx.suppressionList.updateMany({ where: { companyId: id }, data: { companyId: null } });
    await tx.company.delete({ where: { id } });
    return { deleted: true as const, name: company.name };
  }, { maxWait: 10_000, timeout: 300_000 });
}
