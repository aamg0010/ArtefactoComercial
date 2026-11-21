import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { isSuppressed } from '../suppression';
import { enqueue } from './outbox';
import { TrygestionClient, TrygestionError } from './client';

const tokenShape = z.object({ companyId: z.string(), expires: z.number() });
export function unsubscribeToken(companyId: string, secret: string) {
  const body = Buffer.from(JSON.stringify({ companyId, expires: Date.now() + 180 * 86400000 })).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
export function readUnsubscribeToken(token: string, secret = process.env.AUTH_SECRET) {
  if (!secret || token.length > 1500) return null;
  try {
    const parts = token.split('.'); if (parts.length !== 2) return null;
    const expected = createHmac('sha256', secret).update(parts[0]).digest(); const given = Buffer.from(parts[1], 'base64url');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    const parsed = tokenShape.parse(JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')));
    return parsed.expires > Date.now() ? parsed.companyId : null;
  } catch { return null; }
}
export async function unsubscribeCompany(db: PrismaClient, token: string, secret?: string) {
  const id = readUnsubscribeToken(token, secret); if (!id) throw new TrygestionError('INVALID_UNSUBSCRIBE_TOKEN');
  await db.$transaction(async tx => {
    const company = await tx.company.findUniqueOrThrow({ where: { id }, include: { contacts: true } });
    if (!await tx.suppressionList.findFirst({ where: { companyId: id } })) await tx.suppressionList.create({ data: { companyId: id, reason: 'Baja solicitada por enlace' } });
    await tx.task.updateMany({ where: { companyId: id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    await tx.companyCadence.updateMany({ where: { companyId: id, status: 'ACTIVE' }, data: { status: 'PAUSED' } });
    await enqueue(tx, 'SUPPRESSION', id, { companyId: id, emails: [company.email, ...company.contacts.map(c => c.email)].filter(Boolean), motivo: 'Baja solicitada por enlace' });
  });
}
export async function sendTaskEmail(db: PrismaClient, raw: unknown, options: { env?: Record<string, string | undefined>; client?: TrygestionClient } = {}) {
  const env = options.env ?? process.env;
  const input = z.object({ taskId: z.string(), userId: z.string(), approved: z.literal(true), to: z.string().email(), subject: z.string().trim().min(1).max(500), body: z.string().trim().min(1).max(30000) }).parse(raw);
  if (env.EMAIL_TRANSPORT !== 'trygestion') throw new TrygestionError('EMAIL_COPY_ONLY');
  const client = options.client ?? new TrygestionClient({ env }); if (!client.enabled) throw new TrygestionError('DISABLED');
  if (!env.AUTH_SECRET || !env.AUTH_URL) throw new TrygestionError('UNSUBSCRIBE_CONFIGURATION_REQUIRED');
  const root = new URL(env.AUTH_URL); if (!['http:', 'https:'].includes(root.protocol) || root.username || root.password) throw new TrygestionError('INVALID_APP_URL');
  const user = await db.user.findUniqueOrThrow({ where: { id: input.userId } });
  if (!['ADMIN', 'SALES'].includes(user.role)) throw new TrygestionError('EMAIL_APPROVAL_FORBIDDEN');
  const task = await db.task.findUniqueOrThrow({ where: { id: input.taskId }, include: { company: { include: { contacts: true } }, script: true } });
  const company = task.company;
  if (task.status !== 'PENDING' || task.type !== 'EMAIL' || company.acceptanceStatus !== 'ACCEPTED' || task.script?.status !== 'APPROVED') throw new TrygestionError('EMAIL_TASK_NOT_APPROVED');
  const recipient = input.to.toLowerCase(); const contacts = company.contacts.filter(c => c.email?.toLowerCase() === recipient);
  if (company.email?.toLowerCase() !== recipient && !contacts.length) throw new TrygestionError('EMAIL_RECIPIENT_NOT_COMPANY_CONTACT');
  if (contacts.some(c => c.requiresConsent && c.consentStatus !== 'GRANTED')) throw new TrygestionError('EMAIL_CONSENT_REQUIRED');
  if (/\[(?:TELÉFONO|WEB)\]/i.test(input.body)) throw new TrygestionError('EMAIL_RESOLVE_VARIABLES');
  if (await isSuppressed(db, company.id)) throw new TrygestionError('COMPANY_SUPPRESSED');
  const hash = createHash('sha256').update(JSON.stringify([recipient, input.subject, input.body])).digest('hex');
  const reserved = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`email:${task.id}`}))`;
    const previous = await tx.emailDispatch.findUnique({ where: { taskId: task.id } });
    if (previous && previous.contentHash !== hash) throw new TrygestionError('EMAIL_CONTENT_CHANGED');
    if (previous?.status === 'SENT') return false;
    if (previous?.status === 'PROCESSING' && Date.now() - previous.updatedAt.getTime() < 120000) throw new TrygestionError('EMAIL_IN_PROGRESS');
    await tx.emailDispatch.upsert({ where: { taskId: task.id }, update: { status: 'PROCESSING', lastError: null }, create: { taskId: task.id, companyId: company.id, approvedBy: user.email, contentHash: hash, opportunityId: company.trygestionOportunidadId, status: 'PROCESSING' } }); return true;
  });
  if (!reserved) return { sent: true, duplicate: true };
  try {
    if (await isSuppressed(db, company.id)) throw new TrygestionError('COMPANY_SUPPRESSED');
    const unsubscribeUrl = new URL(`/baja/${unsubscribeToken(company.id, env.AUTH_SECRET)}`, root).toString();
    const text = `${input.body}\n\ntry! company · Contacto comercial B2B. Para dejar de recibir comunicaciones responde BAJA o confirma tu baja: ${unsubscribeUrl}`;
    const html = `<p>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br>')}</p>`;
    await client.enviarEmail({ to: recipient, subject: input.subject, text, html, approvedBy: user.email, ...(user.name?.trim() ? { firmante: user.name.trim() } : {}), externalRef: `task:${task.id}`, unsubscribeUrl, ...(company.trygestionOportunidadId ? { oportunidadId: company.trygestionOportunidadId } : {}) });
    await db.emailDispatch.update({ where: { taskId: task.id }, data: { status: 'SENT', sentAt: new Date() } });
    return { sent: true, duplicate: false };
  } catch (error) {
    const code = error instanceof TrygestionError ? error.code : 'EMAIL_SEND_ERROR';
    await db.emailDispatch.update({ where: { taskId: task.id }, data: { status: 'FAILED', lastError: code } });
    throw new TrygestionError(code);
  }
}
