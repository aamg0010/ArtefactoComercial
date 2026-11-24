import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isSafeTestDatabase } from '../test-database';
import { prepareEmailInput, prepareScriptEmail } from './prepare-email';
import { taskEmail } from './script-email';

const url = process.env.TEST_DATABASE_URL;
const enabled = isSafeTestDatabase(url, process.env.DATABASE_URL);
const prisma = enabled ? new PrismaClient({ datasources: { db: { url } } }) : undefined;
const now = new Date('2026-11-23T23:30:00Z'); // Ya es 24 en Madrid.
const emails = [{ dia: 1, asunto: 'Primer email', cuerpo: 'Primer cuerpo' }, { dia: 6, asunto: 'Segundo email', cuerpo: 'Segundo cuerpo' }];
it('valida ids legibles y rechaza ids inseguros', () => {
  expect(prepareEmailInput.safeParse({ companyId: 'company-legible', scriptId: 'script-legible', emailIndex: '1', userId: 'sales-user' }).success).toBe(true);
  expect(prepareEmailInput.safeParse({ companyId: '../escape', scriptId: 'script', emailIndex: -1, userId: 'user' }).success).toBe(false);
  expect(prepareEmailInput.safeParse({ companyId: 'company', scriptId: 'script', emailIndex: null, userId: 'user' }).success).toBe(false);
});
describe.runIf(enabled)('preparación de emails en PostgreSQL aislado', () => {
  const db = prisma!;
  const companyId = 'fase8-test-company'; const scriptId = 'fase8-test-script'; const userId = 'fase8-test-user';
  const input = { companyId, scriptId, userId, emailIndex: 1 };
  beforeAll(async () => { await db.user.upsert({ where: { id: userId }, update: {}, create: { id: userId, email: 'fase8@test.invalid', role: 'SALES' } }); });
  beforeEach(async () => {
    await db.company.deleteMany({ where: { id: companyId } });
    await db.cadence.deleteMany({ where: { id: 'fase8-test-cadence' } });
    await db.company.create({ data: { id: companyId, name: '[SIMULADA] Fase 8', normalizedName: 'fase8 test', fictional: true, country: 'ES', scripts: { create: { id: scriptId, author: 'Prueba', status: 'APPROVED', content: { emails } } } } });
  });
  afterAll(async () => {
    await db.company.deleteMany({ where: { id: companyId } });
    await db.cadence.deleteMany({ where: { id: 'fase8-test-cadence' } });
    await db.auditLog.deleteMany({ where: { userId } });
    await db.user.deleteMany({ where: { id: userId } }); await db.$disconnect();
  });
  it('crea hoy, asigna el usuario y conserva el email seleccionado sin paso', async () => {
    const task = await prepareScriptEmail(db, input, now);
    expect(task).toMatchObject({ companyId, scriptId, assigneeId: userId, title: 'Email: Segundo email', scriptEmailIndex: 1, dueAt: new Date('2026-11-24T00:00:00Z') });
    expect(taskEmail({ ...task, script: { content: { emails } }, cadenceStep: null })).toEqual(emails[1]);
    expect(await db.auditLog.count({ where: { entityId: task.id, action: 'EMAIL_PREPARED_FROM_SCRIPT' } })).toBe(1);
    expect(await db.syncOutbox.count({ where: { entityId: task.id } })).toBe(0);
  });
  it('reutiliza el paso correcto y adelanta su fecha futura', async () => {
    const cadence = await db.cadence.create({ data: { id: 'fase8-test-cadence', name: 'Fase8 test', steps: { create: { type: 'EMAIL', dayOffset: 6, action: 'Email' } } }, include: { steps: true } });
    const cc = await db.companyCadence.create({ data: { companyId, cadenceId: cadence.id, scriptId, startDate: now } });
    const existing = await db.task.create({ data: { companyId, scriptId, companyCadenceId: cc.id, cadenceStepId: cadence.steps[0].id, type: 'EMAIL', title: 'Email futuro', dueAt: new Date('2026-12-01') } });
    expect(await prepareScriptEmail(db, input, now)).toMatchObject({ id: existing.id, scriptEmailIndex: 1, dueAt: new Date('2026-11-24') });
    const first = await prepareScriptEmail(db, { ...input, emailIndex: 0 }, now);
    expect(first.id).not.toBe(existing.id);
  });
  it('dos clics concurrentes sin paso crean una sola tarea', async () => {
    const [a, b] = await Promise.all([prepareScriptEmail(db, input, now), prepareScriptEmail(db, input, now)]);
    expect(a.id).toBe(b.id); expect(await db.task.count({ where: { companyId } })).toBe(1);
  });
  it('conserva la fecha vencida y permite volver a preparar tras completar', async () => {
    const first = await prepareScriptEmail(db, input, now);
    await db.task.update({ where: { id: first.id }, data: { dueAt: new Date('2026-11-20') } });
    expect((await prepareScriptEmail(db, input, now)).dueAt).toEqual(new Date('2026-11-20'));
    await db.task.update({ where: { id: first.id }, data: { status: 'COMPLETED' } });
    expect((await prepareScriptEmail(db, input, now)).id).not.toBe(first.id);
  });
  it('rechaza borrador', async () => {
    await db.script.update({ where: { id: scriptId }, data: { status: 'BORRADOR' } });
    await expect(prepareScriptEmail(db, input, now)).rejects.toThrow('Aprueba el guion');
    expect(await db.task.count({ where: { companyId } })).toBe(0);
  });
  it.each(['PENDING', 'DISCARDED'] as const)('rechaza empresa %s', async acceptanceStatus => {
    await db.company.update({ where: { id: companyId }, data: { acceptanceStatus } });
    await expect(prepareScriptEmail(db, input, now)).rejects.toThrow('Acepta la empresa');
  });
  it('rechaza baja y director', async () => {
    await db.suppressionList.create({ data: { companyId, reason: 'Fase8 baja' } });
    await expect(prepareScriptEmail(db, input, now)).rejects.toThrow('baja');
    await db.user.update({ where: { id: userId }, data: { role: 'DIRECTOR' } });
    try { await expect(prepareScriptEmail(db, input, now)).rejects.toThrow('No autorizado'); }
    finally { await db.user.update({ where: { id: userId }, data: { role: 'SALES' } }); }
  });
});
