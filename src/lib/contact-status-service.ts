import type { Prisma, PrismaClient } from '@prisma/client';
import { contactStatus, contactBarrier, ContactBarrierError } from './contact-status';
import { matchesSuppression } from './suppression';
type DB = PrismaClient | Prisma.TransactionClient;
/** Fixed number of batched queries for every list, including shared suppression identifiers and dispatches. */
export async function loadContactStatuses(db: DB, ids: string[], now = new Date()) {
  const [companies, suppressions, emails] = await Promise.all([
    db.company.findMany({ where: { id: { in: ids } }, include: { contacts: true, activities: { where: { type: { in: ['CALL', 'EMAIL', 'MEETING'] } }, orderBy: { createdAt: 'desc' }, take: 1, include: { author: { select: { name: true, email: true } } } }, tasks: { where: { status: { in: ['PENDING', 'COMPLETED'] } }, include: { cadenceStep: true } }, cadences: true, emailReplies: { where: { status: 'NEW' }, select: { status: true } } } }),
    db.suppressionList.findMany(), db.emailDispatch.findMany({ where: { companyId: { in: ids }, status: 'SENT', sentAt: { not: null } }, select: { companyId: true, sentAt: true, approvedBy: true, approver: { select: { name: true, email: true } } } }),
  ]);
  return new Map(companies.map(c => [c.id, { ...contactStatus({ ...c, suppressed: matchesSuppression(c, suppressions), sentEmailDetails: emails.filter(e => e.companyId === c.id), sentEmails: emails.filter(e => e.companyId === c.id).map(e => e.sentAt!) }, now), historyHref: `/empresas/${c.id}#historial` }]));
}
export async function enforceContactBarrier(db: DB, companyId: string, confirmed: boolean, userId: string, action: string, now = new Date()) {
  const status = (await loadContactStatuses(db, [companyId], now)).get(companyId);
  if (!status) throw new Error('Empresa no encontrada');
  if (!contactBarrier(status, confirmed).allowed) throw new ContactBarrierError(status.color === 'red' ? 'CONTACT_CONFIRMATION_REQUIRED' : 'CONTACT_BLOCKED', status.color === 'red' ? `Confirma: Sí, quiero contactarla igualmente. ${status.detail}` : status.detail);
  if (status.color === 'red') await db.auditLog.create({ data: { userId, entityType: 'Company', entityId: companyId, action: 'CONTACT_WAIT_OVERRIDE', metadata: { action, lastContact: status.lastContact, nextContact: status.nextContact } } });
}
