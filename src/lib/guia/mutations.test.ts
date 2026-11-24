import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isSafeTestDatabase } from '../test-database';
import { guideInput, mutateGuide, pauseClosedCycles, reminderId } from './mutations';
import { completeTask } from '../tasks';
import { loadGuide } from './service';
import { addDays } from './engine';

const url = process.env.TEST_DATABASE_URL;
const enabled = isSafeTestDatabase(url, process.env.DATABASE_URL);
const db = enabled ? new PrismaClient({ datasources: { db: { url } } }) : undefined;
const userId = 'guia-test-sales'; const companyId = 'guia-test-company'; const cadenceId = 'guia-test-cycle';
const now = new Date('2026-11-24T12:00Z');
it('valida ids legibles, días y fechas reales', () => {
  expect(guideInput.safeParse({ action: 'next', userId, companyId, type: 'CALL', date: '2026-02-30' }).success).toBe(false);
  expect(guideInput.safeParse({ action: 'pause', userId, companyId: '../escape', cadenceId }).success).toBe(false);
  expect(guideInput.safeParse({ action: 'postpone', userId, taskId: 'legible', expectedDay: '2026-11-24', days: 2 }).success).toBe(false);
});

describe.runIf(enabled)('guía: acciones transaccionales en PostgreSQL de pruebas', () => {
  const prisma = db!;
  beforeAll(async () => { await prisma.user.upsert({ where: { id: userId }, update: {}, create: { id: userId, email: 'guia-test@invalid.test', role: 'SALES' } }); });
  beforeEach(async () => {
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.cadence.deleteMany({ where: { id: 'guia-test-standard' } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId }, { entityId: cadenceId }] } });
    await prisma.user.update({ where: { id: userId }, data: { role: 'SALES' } });
    await prisma.company.create({ data: { id: companyId, name: '[SIMULADA] Guía pruebas', normalizedName: 'guia pruebas', fictional: true, country: 'ES', pipelineStage: 'CONTACTING' } });
  });
  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.cadence.deleteMany({ where: { id: 'guia-test-standard' } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId }, { entityId: cadenceId }] } });
    await prisma.user.deleteMany({ where: { id: userId } }); await prisma.$disconnect();
  });
  const cycle = async (closedAt = new Date('2026-11-23T12:00Z')) => {
    await prisma.cadence.create({ data: { id: 'guia-test-standard', name: 'Guía test', steps: { create: { id: 'guia-test-step15', type: 'EMAIL', dayOffset: 15, action: 'Email de cierre de ciclo' } } } });
    await prisma.companyCadence.create({ data: { id: cadenceId, companyId, cadenceId: 'guia-test-standard', startDate: new Date('2026-11-01') } });
    await prisma.task.create({ data: { id: 'guia-test-done15', companyId, companyCadenceId: cadenceId, cadenceStepId: 'guia-test-step15', type: 'EMAIL', title: 'Cierre', status: 'COMPLETED', completedAt: closedAt, result: 'No contesta' } });
  };
  it.each([1, 3, 7])('pospone %s días desde hoy una vencida; repetir o concurrir no duplica ni mueve de nuevo', async days => {
    const task = await prisma.task.create({ data: { companyId, type: 'CALL', title: 'Vencida', dueAt: new Date('2026-11-20') } });
    const input = { action: 'postpone', userId, taskId: task.id, expectedDay: '2026-11-20', days };
    await Promise.all([mutateGuide(prisma, input, now), mutateGuide(prisma, input, now)]);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).dueAt).toEqual(new Date(addDays('2026-11-24', days)));
    expect(await prisma.auditLog.count({ where: { entityId: task.id, action: 'GUIDE_POSTPONE' } })).toBe(1);
  });
  it('crea un próximo paso y reutiliza dos peticiones concurrentes', async () => {
    const input = { action: 'next', companyId, userId, type: 'EMAIL', date: '2026-11-25' };
    const [a, b] = await Promise.all([mutateGuide(prisma, input, now), mutateGuide(prisma, input, now)]);
    expect(a!.id).toBe(b!.id); expect(await prisma.task.count({ where: { companyId } })).toBe(1);
    expect((await loadGuide(prisma, { userId, role: 'SALES' }, now)).groups.find(g => g.id === 'next')!.count).toBe(0);
    await prisma.task.update({ where: { id: a!.id }, data: { status: 'COMPLETED', completedAt: now } });
    expect((await mutateGuide(prisma, input, now))!.id).toBe(a!.id);
    expect(await prisma.task.count({ where: { companyId } })).toBe(1);
  });
  it('pausa al momento y crea un único recordatorio, también concurrente con el paso diario', async () => {
    await cycle();
    const input = { action: 'pause', userId, companyId, cadenceId };
    await Promise.all([mutateGuide(prisma, input, now), pauseClosedCycles(prisma, now), mutateGuide(prisma, input, now)]);
    expect((await prisma.companyCadence.findUniqueOrThrow({ where: { id: cadenceId } })).status).toBe('PAUSED');
    expect(await prisma.task.count({ where: { id: reminderId(cadenceId) } })).toBe(1);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: reminderId(cadenceId) } })).dueAt).toEqual(new Date('2027-02-22'));
    expect(await prisma.auditLog.count({ where: { entityId: cadenceId, action: 'GUIDE_PAUSE_90' } })).toBe(1);
    expect(await pauseClosedCycles(prisma, now)).toEqual({ paused: 0 });
  });
  it('el paso diario espera 24 horas; al cumplirse actúa una sola vez', async () => {
    await cycle(new Date('2026-11-23T12:00:01Z'));
    expect(await pauseClosedCycles(prisma, now)).toEqual({ paused: 0 });
    expect(await pauseClosedCycles(prisma, new Date('2026-11-24T12:00:01Z'))).toEqual({ paused: 1 });
    expect(await pauseClosedCycles(prisma, new Date('2026-11-25'))).toEqual({ paused: 0 });
  });
  it('no pausa si ya hay respuesta HANDLED ni si hay resultado positivo', async () => {
    await cycle();
    const reply = await prisma.emailReply.create({ data: { companyId, trygestionId: 'guia-test-reply', fromEmail: 'cliente@invalid.test', subject: 'Gracias', method: 'hilo', receivedAt: now, status: 'HANDLED' } });
    expect(await pauseClosedCycles(prisma, now)).toEqual({ paused: 0 });
    await prisma.emailReply.delete({ where: { id: reply.id } });
    await prisma.activity.create({ data: { companyId, type: 'CALL', result: 'Contactado' } });
    expect(await mutateGuide(prisma, { action: 'pause', companyId, userId, cadenceId }, now)).toBeNull();
  });
  it('Hecho es idempotente y produce una actividad', async () => {
    const task = await prisma.task.create({ data: { companyId, type: 'CALL', title: 'Llamada' } });
    await Promise.all([completeTask(prisma, task.id, 'No contesta', userId), completeTask(prisma, task.id, 'No contesta', userId)]);
    expect(await prisma.activity.count({ where: { taskId: task.id } })).toBe(1);
  });
  it('rechaza director, usuario inexistente, propietario ajeno y asignación ajena', async () => {
    const next = { action: 'next', userId, companyId, type: 'CALL', date: '2026-11-25' };
    await prisma.user.update({ where: { id: userId }, data: { role: 'DIRECTOR' } });
    await expect(mutateGuide(prisma, next, now)).rejects.toThrow('No autorizado');
    await expect(mutateGuide(prisma, { ...next, userId: 'inexistente' }, now)).rejects.toThrow();
    const task = await prisma.task.create({ data: { companyId, type: 'CALL', title: 'Prueba' } });
    await expect(completeTask(prisma, task.id, 'No contesta', userId)).rejects.toThrow('No autorizado');
    await prisma.user.update({ where: { id: userId }, data: { role: 'SALES' } });
    const other = await prisma.user.findFirstOrThrow({ where: { id: { not: userId } } });
    await prisma.company.update({ where: { id: companyId }, data: { ownerId: other.id } });
    await expect(mutateGuide(prisma, next, now)).rejects.toThrow('No autorizado');
    await prisma.company.update({ where: { id: companyId }, data: { ownerId: null } });
    await prisma.task.update({ where: { id: task.id }, data: { assigneeId: other.id } });
    await expect(mutateGuide(prisma, { action: 'postpone', taskId: task.id, userId, days: 1, expectedDay: null }, now)).rejects.toThrow('No autorizado');
    await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
    await expect(mutateGuide(prisma, next, now)).resolves.toBeTruthy();
  });
});
