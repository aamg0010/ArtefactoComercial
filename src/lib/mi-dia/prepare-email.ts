import { enforceContactBarrier } from '../contact-status-service';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { madridDate, taskDate } from '../dates';
import { isSuppressed } from '../suppression';
import { safeId, scriptEmails } from './script-email';

export const prepareEmailInput = z.object({
  contactConfirmed: z.boolean().default(false), companyId: safeId, scriptId: safeId, userId: safeId,
  emailIndex: z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().min(0).max(1000)),
});

export async function prepareScriptEmail(db: PrismaClient, raw: unknown, now = new Date()) {
  const input = prepareEmailInput.parse(raw);
  const day = madridDate(now);
  return db.$transaction(async tx => {
    // Todas las preparaciones del mismo guion se serializan, incluso sin paso de cadencia.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`prepare-email:${input.scriptId}`}))`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId } });
    if (user.role === 'DIRECTOR') throw new Error('No autorizado');
    const script = await tx.script.findFirstOrThrow({ where: { id: input.scriptId, companyId: input.companyId }, include: { company: true } });
    if (script.status !== 'APPROVED') throw new Error('Aprueba el guion para poder enviar sus emails');
    if (script.company.acceptanceStatus !== 'ACCEPTED') throw new Error('Acepta la empresa antes de preparar emails');
    if (await isSuppressed(tx, input.companyId)) throw new Error('La empresa ha solicitado la baja y no puede recibir emails');
    await enforceContactBarrier(tx, input.companyId, input.contactConfirmed, input.userId, 'PREPARE_EMAIL', now);
    const email = scriptEmails.parse(script.content).emails[input.emailIndex];
    if (!email) throw new Error('Email del guion no encontrado');
    const existing = await tx.task.findFirst({ where: {
      companyId: input.companyId, scriptId: script.id, type: 'EMAIL', status: 'PENDING',
      OR: [{ scriptEmailIndex: input.emailIndex }, { scriptEmailIndex: null, cadenceStep: { dayOffset: email.dia } }],
    }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    let task;
    if (existing) {
      task = await tx.task.update({ where: { id: existing.id }, data: {
        scriptEmailIndex: input.emailIndex,
        ...(!existing.dueAt || taskDate(existing.dueAt)! > day ? { dueAt: new Date(`${day}T00:00:00.000Z`) } : {}),
      } });
    } else {
      const cadence = await tx.companyCadence.findFirst({ where: { companyId: input.companyId, scriptId: script.id }, include: { cadence: { include: { steps: true } } } });
      const step = cadence?.cadence.steps.find(step => step.type === 'EMAIL' && step.dayOffset === email.dia);
      // La restricción histórica empresa/paso también incluye tareas completadas.
      const occupied = step && await tx.task.findUnique({ where: { companyId_cadenceStepId: { companyId: input.companyId, cadenceStepId: step.id } } });
      task = await tx.task.create({ data: {
        companyId: input.companyId, scriptId: script.id, scriptEmailIndex: input.emailIndex,
        companyCadenceId: cadence?.id, cadenceStepId: occupied ? undefined : step?.id,
        assigneeId: input.userId, type: 'EMAIL', title: `Email: ${email.asunto}`, dueAt: new Date(`${day}T00:00:00.000Z`),
      } });
    }
    // Preparar una tarea no genera una actividad ni un envío en trygestión.
    await tx.auditLog.create({ data: { userId: input.userId, entityType: 'Task', entityId: task.id, action: 'EMAIL_PREPARED_FROM_SCRIPT', metadata: { scriptId: script.id, emailIndex: input.emailIndex, day: email.dia, reused: Boolean(existing) } } });
    return task;
  });
}
