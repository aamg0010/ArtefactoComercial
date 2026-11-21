import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient, type SyncKind } from '@prisma/client';

export type OutboxDb = PrismaClient | Prisma.TransactionClient;
export async function enqueue(db: OutboxDb, kind: SyncKind, entityId: string, payload: Record<string, unknown> = {}, version = '') {
  const snapshot = JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
  const hash = createHash('sha256').update(JSON.stringify({ payload: snapshot, version })).digest('hex');
  const idempotencyKey = `${kind}:${entityId}:${hash}`;
  return db.syncOutbox.upsert({ where: { idempotencyKey }, update: {}, create: { kind, entityId, payload: snapshot, idempotencyKey } });
}
export async function enqueueCompany(db: OutboxDb, companyId: string, revision?: string) {
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company || company.acceptanceStatus !== 'ACCEPTED') return null;
  // Only a fingerprint is retained; the worker reads the latest owned CRM data.
  const fingerprint = createHash('sha256').update(JSON.stringify([company.name, company.nifNit, company.website, company.city, company.region, company.country, company.email, company.phone, company.sector, company.priority, revision])).digest('hex');
  return enqueue(db, 'COMPANY_UPSERT', companyId, {}, fingerprint);
}
export async function backfillCompanies(db: PrismaClient, companyId?: string) {
  const companies = await db.company.findMany({ where: { acceptanceStatus: 'ACCEPTED', ...(companyId ? { id: companyId } : {}) }, select: { id: true } });
  for (const company of companies) await db.$transaction(async tx => {
    await enqueueCompany(tx, company.id);
    const contacts = await tx.contact.findMany({ where: { companyId: company.id } });
    for (const contact of contacts) await enqueueContact(tx, contact.id);
  });
  return companies.length;
}
export async function enqueueContact(db: OutboxDb, contactId: string) {
  const contact = await db.contact.findUnique({ where: { id: contactId }, include: { company: true } });
  if (!contact || contact.company.acceptanceStatus !== 'ACCEPTED') return;
  const revision = createHash('sha256').update(JSON.stringify([contact.fullName, contact.role, contact.email, contact.phone])).digest('hex');
  return enqueue(db, 'CONTACT_UPSERT', contactId, { companyId: contact.companyId }, revision);
}
export async function enqueuePipeline(db: OutboxDb, companyId: string, stage: string, revision: string, reason?: string) {
  const closed = ['WON', 'LOST'].includes(stage);
  return enqueue(db, closed ? 'OPPORTUNITY_STATUS' : 'OPPORTUNITY_STAGE', companyId, closed ? { companyId, estado: stage === 'WON' ? 'ganada' : 'perdida', motivo: reason ?? 'Cambio desde try! Comercial' } : { companyId, stage }, revision);
}
