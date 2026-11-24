import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { safeId } from './mi-dia/script-email';
import { madridDate } from './dates';
import { enqueuePipeline } from './trygestion/outbox';

export const pipelineStages = [['DETECTED', 'Detectada'], ['RESEARCHED', 'Investigada'], ['CONTACTING', 'En contacto'], ['MEETING', 'Reunión'], ['PROPOSAL', 'Propuesta'], ['NEGOTIATION', 'Negociación'], ['WON', 'Ganada'], ['LOST', 'Perdida']] as const;
const stage = z.enum(['DETECTED', 'RESEARCHED', 'CONTACTING', 'MEETING', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST']);
export function tomorrowMadrid(now = new Date()) {
  const date = new Date(`${madridDate(now)}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10);
}
export const handleReplyInput = z.discriminatedUnion('action', [
  z.object({ replyId: safeId, userId: safeId, action: z.literal('vista') }),
  z.object({ replyId: safeId, userId: safeId, action: z.literal('etapa'), stage }),
  z.object({ replyId: safeId, userId: safeId, action: z.literal('seguimiento'), type: z.enum(['CALL', 'EMAIL', 'FOLLOW_UP']), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const d = new Date(`${value}T00:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value; }), note: z.string().trim().max(2000).default('') }),
]);
export async function handleEmailReply(db: PrismaClient, raw: unknown) {
  const input = handleReplyInput.parse(raw);
  return db.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user || user.role === 'DIRECTOR') throw new Error('No autorizado.');
    // Row lock protects all three actions against simultaneous clicks from any screen.
    await tx.$queryRaw`SELECT id FROM "EmailReply" WHERE id = ${input.replyId} FOR UPDATE`;
    const reply = await tx.emailReply.findUniqueOrThrow({ where: { id: input.replyId } });
    if (reply.status === 'HANDLED') return reply;
    if (input.action !== 'vista' && !reply.companyId) throw new Error('Sin empresa vinculada.');
    if (input.action === 'seguimiento') await tx.task.create({ data: {
      companyId: reply.companyId!, assigneeId: user.id, type: input.type, title: `Seguimiento: ${reply.subject}`,
      dueAt: new Date(`${input.date}T00:00:00Z`), result: input.note || null,
    } });
    if (input.action === 'etapa') {
      await tx.company.update({ where: { id: reply.companyId! }, data: { pipelineStage: input.stage } });
      await enqueuePipeline(tx, reply.companyId!, input.stage, `reply:${reply.id}`);
    }
    return tx.emailReply.update({ where: { id: reply.id }, data: { status: 'HANDLED', handledAt: new Date(), handledById: user.id, handledAction: input.action } });
  });
}
