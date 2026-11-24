import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TrygestionClient } from './client';
import { syncEmailReplies } from './replies';
import { startTrygestionMock } from './testing/mock-server';
import { handleEmailReply, handleReplyInput, tomorrowMadrid } from '../email-replies';
import { isSafeTestDatabase } from '../test-database';

const reply = (changes: Record<string, unknown> = {}) => ({ id: randomUUID(), envio_id: 'envio-test', external_ref: null, oportunidad_id: null, remitente: 'info@fase9.invalid', asunto: 'Re: Propuesta Fase9', recibido_en: '2026-11-24T12:00:00Z', resumen: 'Solicita una llamada', categoria: 'interesado', prioridad: 'alta', extracto: 'Podemos hablar mañana.', metodo: 'hilo', creado_en: '2026-11-24 12:01:00', ...changes });
const env = { TRYGESTION_URL: 'http://127.0.0.1:3198/api', TRYGESTION_TOKEN: 'test' };
it('valida el contrato, codifica el cursor y utiliza las cabeceras del cliente', async () => {
  const row = reply();
  const client = new TrygestionClient({ env, fetcher: async (url, init) => {
    expect(String(url)).toContain('desde=2026-11-24+12%3A01%3A00'); expect(String(url)).toContain('limite=100');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test' });
    return Response.json({ respuestas: [row] });
  } });
  expect(await client.respuestas('2026-11-24 12:01:00')).toEqual([row]);
  for (const changes of [{ prioridad: 'inventada' }, { id: 'no-uuid' }, { recibido_en: 'ayer' }, { creado_en: '2026-02-30 12:00:00' }, { extracto: 'a'.repeat(2001) }]) {
    await expect(new TrygestionClient({ env, fetcher: async () => Response.json({ respuestas: [reply(changes)] }) }).respuestas()).rejects.toThrow('INVALID_RESPONSE');
  }
});
it('404 y desactivación devuelven lista vacía, otros errores se conservan', async () => {
  expect(await new TrygestionClient({ env, fetcher: async () => new Response('', { status: 404 }) }).respuestas()).toEqual([]);
  expect(await new TrygestionClient({ env: {}, fetcher: async () => { throw new Error('No debe llamar'); } }).respuestas()).toEqual([]);
  await expect(new TrygestionClient({ env, fetcher: async () => new Response('', { status: 401 }) }).respuestas()).rejects.toThrow('UNAUTHORIZED');
});
it('mañana parte de Madrid incluso al cambiar el año o el horario de verano; valida ids legibles y fechas', () => {
  expect(tomorrowMadrid(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-02');
  expect(tomorrowMadrid(new Date('2026-03-28T23:30:00Z'))).toBe('2026-03-30');
  expect(handleReplyInput.safeParse({ replyId: 'reply-legible', userId: 'user-1', action: 'vista' }).success).toBe(true);
  expect(handleReplyInput.safeParse({ replyId: '../escape', userId: 'u', action: 'vista' }).success).toBe(false);
  expect(handleReplyInput.safeParse({ replyId: 'r', userId: 'u', action: 'seguimiento', type: 'CALL', date: '2026-02-30' }).success).toBe(false);
});

const url = process.env.TEST_DATABASE_URL;
const enabled = isSafeTestDatabase(url, process.env.DATABASE_URL);
describe.runIf(enabled)('respuestas entrantes y gestión en PostgreSQL aislado', () => {
  const db = enabled ? new PrismaClient({ datasources: { db: { url } } }) : null!;
  let mock: Awaited<ReturnType<typeof startTrygestionMock>>;
  let client: TrygestionClient;
  const companyId = 'fase9-test-company', userId = 'fase9-test-user';
  beforeAll(async () => {
    mock = await startTrygestionMock(); client = new TrygestionClient({ env: { TRYGESTION_URL: mock.url, TRYGESTION_TOKEN: mock.token } });
    await db.user.upsert({ where: { id: userId }, create: { id: userId, email: 'fase9@test.invalid', role: 'SALES' }, update: { role: 'SALES' } });
  });
  beforeEach(async () => {
    await db.emailReply.deleteMany(); await db.emailReplySync.deleteMany(); await db.syncOutbox.deleteMany();
    await db.company.deleteMany({ where: { id: companyId } });
    await db.company.create({ data: { id: companyId, name: '[SIMULADA] Fase9', normalizedName: 'fase9', country: 'ES', fictional: true, email: 'INFO@fase9.invalid' } });
    mock.state.replies.length = 0; mock.state.failures.clear();
  });
  afterAll(async () => {
    await db.emailReply.deleteMany(); await db.emailReplySync.deleteMany(); await db.syncOutbox.deleteMany();
    await db.company.deleteMany({ where: { id: companyId } }); await db.user.deleteMany({ where: { id: userId } });
    await mock.close(); await db.$disconnect();
  });
  const sync = () => syncEmailReplies(db, client);
  const localReply = async (company: string | null = companyId) => db.emailReply.create({ data: { companyId: company, trygestionId: randomUUID(), fromEmail: 'info@fase9.invalid', subject: 'Propuesta Fase9', receivedAt: new Date(), method: 'hilo' } });
  it('vincula task legible, empresa y contacto sin distinguir mayúsculas; guarda desconocidos y bajas sin outbox', async () => {
    await db.task.create({ data: { id: 'fase9-task-legible', companyId, title: 'Email original', type: 'EMAIL' } });
    await db.contact.create({ data: { companyId, fullName: 'Contacto', email: 'VENTAS@contacto.invalid' } });
    await db.suppressionList.create({ data: { companyId, reason: 'Baja Fase9' } });
    const rows = [reply({ external_ref: 'task:fase9-task-legible', remitente: 'otro@otro.invalid' }), reply(), reply({ remitente: 'ventas@contacto.invalid' }), reply({ remitente: 'desconocido@otro.invalid' })];
    mock.state.replies.push(...rows);
    expect(await sync()).toMatchObject({ imported: 4, error: null });
    const saved = await db.emailReply.findMany();
    expect(saved.find(row => row.trygestionId === rows[0].id)).toMatchObject({ taskId: 'fase9-task-legible', companyId });
    expect(saved.filter(row => row.companyId === companyId)).toHaveLength(3);
    expect(saved.find(row => row.trygestionId === rows[3].id)?.companyId).toBeNull();
    expect(await db.syncOutbox.count()).toBe(0); expect(await db.activity.count({ where: { companyId } })).toBe(0);
    expect(await db.emailReplySync.findUnique({ where: { id: 'trygestion' } })).toMatchObject({ cursor: rows[0].creado_en });
  });
  it('deduplica ids y acepta respuestas posteriores con el mismo creado_en sin reabrir gestionadas', async () => {
    const first = reply(); mock.state.replies.push(first); await sync();
    const saved = await db.emailReply.findUniqueOrThrow({ where: { trygestionId: first.id } });
    await handleEmailReply(db, { replyId: saved.id, userId, action: 'vista' });
    mock.state.replies.push(reply()); expect(await sync()).toMatchObject({ imported: 1 });
    expect(await db.emailReply.count()).toBe(2);
    expect(await db.emailReply.findUnique({ where: { id: saved.id } })).toMatchObject({ status: 'HANDLED', handledAction: 'vista' });
  });
  it('pagina de 100 hasta agotar, y limita a 10 páginas', async () => {
    for (let i = 0; i < 1050; i++) mock.state.replies.push(reply({ creado_en: new Date(Date.UTC(2026, 10, 24, 0, 0, i)).toISOString().slice(0, 19).replace('T', ' ') }));
    expect(await sync()).toMatchObject({ pages: 10, imported: 991 });
    expect(await sync()).toMatchObject({ pages: 1, imported: 59 });
    expect(await db.emailReply.count()).toBe(1050);
  }, 30000);
  it('detecta saturación del cursor sin saltar el segundo y conserva datos al fallar la red', async () => {
    for (let i = 0; i < 101; i++) mock.state.replies.push(reply());
    expect(await sync()).toMatchObject({ error: 'REPLY_CURSOR_SATURATED', imported: 100 });
    const before = await db.emailReplySync.findUniqueOrThrow({ where: { id: 'trygestion' } });
    mock.state.failures.set('GET /comercial/respuestas', [500]);
    expect(await sync()).toMatchObject({ error: 'HTTP_500' });
    expect((await db.emailReplySync.findUniqueOrThrow({ where: { id: 'trygestion' } })).cursor).toBe(before.cursor);
  });
  it('seguimientos concurrentes crean una sola tarea asignada con nota y marcan HANDLED', async () => {
    const r = await localReply(); const input = { replyId: r.id, userId, action: 'seguimiento', type: 'CALL', date: '2026-11-25', note: 'Llamar por la tarde' };
    await Promise.all([handleEmailReply(db, input), handleEmailReply(db, input)]);
    expect(await db.task.count({ where: { companyId } })).toBe(1);
    expect(await db.task.findFirst({ where: { companyId } })).toMatchObject({ status: 'PENDING', assigneeId: userId, dueAt: new Date('2026-11-25'), result: input.note, title: `Seguimiento: ${r.subject}` });
    expect(await db.emailReply.findUnique({ where: { id: r.id } })).toMatchObject({ status: 'HANDLED', handledById: userId, handledAction: 'seguimiento', handledAt: expect.any(Date) });
    expect(await db.syncOutbox.count()).toBe(0);
  });
  it('etapa encola una sola vez con el mecanismo existente; vista no encola', async () => {
    const r = await localReply(); const input = { replyId: r.id, userId, action: 'etapa', stage: 'PROPOSAL' };
    await Promise.all([handleEmailReply(db, input), handleEmailReply(db, input)]);
    expect(await db.company.findUnique({ where: { id: companyId } })).toMatchObject({ pipelineStage: 'PROPOSAL' });
    expect(await db.syncOutbox.findMany()).toEqual([expect.objectContaining({ kind: 'OPPORTUNITY_STAGE', payload: { companyId, stage: 'PROPOSAL' } })]);
    const unlinked = await localReply(null); await handleEmailReply(db, { replyId: unlinked.id, userId, action: 'vista' });
    expect(await db.emailReply.findUnique({ where: { id: unlinked.id } })).toMatchObject({ status: 'HANDLED', handledAction: 'vista' });
  });
  it('rechaza seguimiento y etapa sin empresa; rechaza director y usuario inexistente', async () => {
    const r = await localReply(null);
    for (const input of [{ action: 'etapa', stage: 'CONTACTING' }, { action: 'seguimiento', type: 'EMAIL', date: '2026-11-25' }]) await expect(handleEmailReply(db, { replyId: r.id, userId, ...input })).rejects.toThrow('Sin empresa');
    await expect(handleEmailReply(db, { replyId: r.id, userId: 'inexistente', action: 'vista' })).rejects.toThrow('No autorizado');
    await db.user.update({ where: { id: userId }, data: { role: 'DIRECTOR' } });
    try { await expect(handleEmailReply(db, { replyId: r.id, userId, action: 'vista' })).rejects.toThrow('No autorizado'); }
    finally { await db.user.update({ where: { id: userId }, data: { role: 'SALES' } }); }
    expect(await db.task.count({ where: { companyId } })).toBe(0);
    expect(await db.emailReply.findUnique({ where: { id: r.id } })).toMatchObject({ status: 'NEW' });
  });
});
