import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { safeId } from '../mi-dia/script-email';
import { madridDate } from '../dates';
import { setCompanyCadenceStatus } from '../cadence';
import { addDays, closedCycle, companyInScope, taskInScope, REMINDER_TITLE, FOLLOWING_STAGES } from './engine';
import { guideInclude } from './service';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
export const guideInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('postpone'), userId: safeId, taskId: safeId, expectedDay: date.nullable(), days: z.coerce.number().pipe(z.union([z.literal(1), z.literal(3), z.literal(7)])) }),
  z.object({ action: z.literal('next'), userId: safeId, companyId: safeId, type: z.enum(['CALL', 'EMAIL', 'FOLLOW_UP']), date }),
  z.object({ action: z.literal('pause'), userId: safeId, companyId: safeId, cadenceId: safeId }),
]);
export const reminderId = (cadenceId: string) => `guia90-${createHash('sha256').update(cadenceId).digest('hex').slice(0, 40)}`;

/** One company lock shared by manual/daily operations; all eligibility is rechecked inside. */
export async function mutateGuide(db: PrismaClient, raw: unknown, now = new Date()) {
  const input = guideInput.parse(raw);
  return db.$transaction(async tx => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId } });
    if (user.role === 'DIRECTOR') throw new Error('No autorizado');
    const original = input.action === 'postpone' ? await tx.task.findUniqueOrThrow({ where: { id: input.taskId } }) : null;
    const companyId = original?.companyId ?? ('companyId' in input ? input.companyId : '');
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId} FOR UPDATE`;
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, include: guideInclude });
    if (!companyInScope(company, { userId: user.id, role: user.role, team: true })) throw new Error('No autorizado');
    if (company.acceptanceStatus !== 'ACCEPTED' || company.suppressions.length) throw new Error('Empresa no disponible');
    if (input.action === 'pause') return pauseInTransaction(tx, company, input.cadenceId, now, user.id);
    if (input.action === 'postpone') {
      const task = company.tasks.find(t => t.id === input.taskId)!;
      if (!taskInScope(task, { userId: user.id, role: user.role, team: true })) throw new Error('No autorizado');
      const actual = task.dueAt?.toISOString().slice(0, 10) ?? null;
      // A replay of the same form cannot keep moving the date.
      if (task.status !== 'PENDING' || actual !== input.expectedDay) return task;
      const dueAt = new Date(`${addDays(actual && actual > madridDate(now) ? actual : madridDate(now), input.days)}T00:00:00Z`);
      const saved = await tx.task.update({ where: { id: task.id }, data: { dueAt } });
      await tx.auditLog.create({ data: { userId: user.id, entityType: 'Task', entityId: task.id, action: 'GUIDE_POSTPONE', metadata: { from: actual, to: dueAt.toISOString(), days: input.days } } });
      return saved;
    }
    if (!FOLLOWING_STAGES.includes(company.pipelineStage)) throw new Error('Empresa fuera de seguimiento');
    // Also prevents two groups (sin paso/paradas) creating the same next action.
    const title = { CALL: 'Llamada de seguimiento', EMAIL: 'Email de seguimiento', FOLLOW_UP: 'Seguimiento comercial' }[input.type];
    const pending = company.tasks.find(t => (t.status === 'PENDING' || t.title === title) && t.type === input.type && t.dueAt?.toISOString().slice(0, 10) === input.date);
    if (pending) return pending;
    const task = await tx.task.create({ data: { companyId, assigneeId: user.id, type: input.type, title, dueAt: new Date(`${input.date}T00:00:00Z`) } });
    await tx.auditLog.create({ data: { userId: user.id, entityType: 'Task', entityId: task.id, action: 'GUIDE_NEXT_STEP' } });
    return task;
  });
}

// Explicit Prisma types keep this helper shared by the cron and the server action.
async function pauseInTransaction(tx: import('@prisma/client').Prisma.TransactionClient, company: import('./engine').GuideCompany, cadenceId: string, now: Date, userId?: string) {
  if (!company.cadences.some(c => c.id === cadenceId)) throw new Error('Cadencia ajena a la empresa');
  const id = reminderId(cadenceId);
  const existing = await tx.task.findUnique({ where: { id } });
  if (existing) return existing;
  if (!closedCycle(company, cadenceId)) return null;
  await setCompanyCadenceStatus(tx, cadenceId, 'PAUSED');
  const task = await tx.task.create({ data: { id, companyId: company.id, companyCadenceId: cadenceId, assigneeId: company.ownerId ?? userId, type: 'FOLLOW_UP', title: REMINDER_TITLE, dueAt: new Date(`${addDays(madridDate(now), 90)}T00:00:00Z`) } });
  await tx.auditLog.create({ data: { userId, entityType: 'CompanyCadence', entityId: cadenceId, action: 'GUIDE_PAUSE_90', metadata: { taskId: task.id, dueAt: task.dueAt!.toISOString() } } });
  return task;
}

export async function pauseClosedCycles(db: PrismaClient, now = new Date()) {
  const candidates = await db.companyCadence.findMany({ where: { status: { in: ['ACTIVE', 'FINISHED'] }, tasks: { some: { status: 'COMPLETED', cadenceStep: { dayOffset: 15 }, type: 'EMAIL' } } }, select: { id: true, companyId: true } });
  let paused = 0;
  for (const candidate of candidates) await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${candidate.companyId} FOR UPDATE`;
    const company = await tx.company.findUniqueOrThrow({ where: { id: candidate.companyId }, include: guideInclude });
    const closed = closedCycle(company, candidate.id);
    if (closed && now.getTime() - closed.getTime() >= 86400000) {
      if (await pauseInTransaction(tx, company, candidate.id, now)) paused++;
    }
  });
  return { paused };
}
