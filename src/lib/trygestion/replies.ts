import type { PrismaClient } from '@prisma/client';
import { TrygestionClient, TrygestionError } from './client';
import { safeId } from '../mi-dia/script-email';

/** Separate inbound lock: overlapping cron/manual runs cannot move the cursor backwards. */
export async function syncEmailReplies(db: PrismaClient, client = new TrygestionClient()) {
  const result = { imported: 0, pages: 0, disabled: !client.enabled, locked: false, error: null as string | null };
  if (!client.enabled) return result;
  return db.$transaction(async tx => {
    const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(48109) AS acquired`;
    if (!lock.acquired) return { ...result, locked: true };
    let cursor = (await tx.emailReplySync.findUnique({ where: { id: 'trygestion' } }))?.cursor ?? undefined;
    for (let page = 0; page < 10; page++) {
      let rows;
      try { rows = await client.respuestas(cursor); }
      catch (error) { result.error = error instanceof TrygestionError ? error.code : 'REPLY_SYNC_ERROR'; break; }
      result.pages++;
      if (!rows.length) break;
      if (rows.some((row, i) => (i > 0 && row.creado_en < rows[i - 1].creado_en) || Boolean(cursor && row.creado_en < cursor))) {
        result.error = 'REPLY_CURSOR_ORDER'; break;
      }
      for (const row of rows) {
        const ref = row.external_ref?.startsWith('task:') ? safeId.safeParse(row.external_ref.slice(5)) : null;
        const task = ref?.success ? await tx.task.findUnique({ where: { id: ref.data }, select: { id: true, companyId: true } }) : null;
        // Ambiguous shared email addresses must not link a reply to an arbitrary customer.
        const matches = task ? [] : await tx.company.findMany({ where: { OR: [{ email: { equals: row.remitente, mode: 'insensitive' } }, { contacts: { some: { email: { equals: row.remitente, mode: 'insensitive' } } } }] }, select: { id: true }, take: 2 });
        const existed = await tx.emailReply.findUnique({ where: { trygestionId: row.id }, select: { id: true } });
        await tx.emailReply.upsert({ where: { trygestionId: row.id }, update: {}, create: {
          trygestionId: row.id, taskId: task?.id, companyId: task?.companyId ?? (matches.length === 1 ? matches[0].id : null),
          externalRef: row.external_ref, fromEmail: row.remitente, subject: row.asunto, receivedAt: new Date(row.recibido_en),
          summary: row.resumen, excerpt: row.extracto, category: row.categoria, priority: row.prioridad, method: row.metodo,
        } });
        if (!existed) result.imported++;
      }
      const last = rows[rows.length - 1].creado_en;
      if (rows.length === 100 && last === cursor) { result.error = 'REPLY_CURSOR_SATURATED'; break; }
      cursor = last;
      await tx.emailReplySync.upsert({ where: { id: 'trygestion' }, create: { cursor }, update: { cursor } });
      if (rows.length < 100) break;
    }
    await tx.emailReplySync.upsert({ where: { id: 'trygestion' }, create: { cursor, lastError: result.error }, update: { lastError: result.error } });
    return result;
  }, { maxWait: 1000, timeout: 240_000 });
}
