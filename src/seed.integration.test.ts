import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { setCompanyCadenceStatus } from './lib/cadence';
import { completeTask } from './lib/tasks';
import { afterAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl) process.env.DATABASE_URL = testDatabaseUrl;
const enabled = Boolean(testDatabaseUrl);
const prisma = new PrismaClient();
const env = { ...process.env, DATABASE_URL: testDatabaseUrl, SEED_ADMIN_PASSWORD: 'integration-admin', SEED_SALES_PASSWORD: 'integration-sales' };
const tsx = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

describe.runIf(enabled)('seed e importación de hoja', () => {
  afterAll(async () => prisma.$disconnect());
  it('es idempotente: conserva 56 empresas, 5 guiones y 121 oportunidades', async () => {
    await run(process.execPath, [tsx, 'prisma/seed-real.ts'], { env });
    await run(process.execPath, [tsx, 'prisma/seed-real.ts'], { env });
    await expect(prisma.company.count()).resolves.toBe(56);
    await expect(prisma.script.count()).resolves.toBe(5);
    await expect(prisma.opportunity.count()).resolves.toBe(121);
    await expect(prisma.task.count()).resolves.toBeGreaterThanOrEqual(56);
    const dated = await prisma.task.findMany({ where: { dueAt: new Date('2026-11-23T00:00:00.000Z') }, include: { company: true } });
    expect(dated.map((task) => task.company.sourceId)).toEqual(expect.arrayContaining(['la-calandina-s-coop', 'cooperativa-ganadera-de-caspe']));
  }, 60_000);
  it('actualiza el estado de una empresa importada', async () => {
    const csv = join(tmpdir(), 'try-comercial-state-update.csv');
    await writeFile(csv, 'id,empresa,estado,prioridad,provincia,municipio,comarca,sector,contacto_corporativo,proxima_accion,fecha_proxima_accion\nla-calandina-s-coop,La Calandina S. Coop.,Contactado,A,Teruel,Calanda,Bajo Aragón,Cooperativa,info@lacalandina.com,Llamar,2026-12-01\n');
    await run(process.execPath, [tsx, 'scripts/import-sheet.ts', csv], { env });
    await expect(prisma.company.findUniqueOrThrow({ where: { sourceId: 'la-calandina-s-coop' } })).resolves.toMatchObject({ pipelineStage: 'CONTACTING', nextAction: 'Llamar' });
  }, 30_000);
  it('conserva el estado comercial al volver a ejecutar el seed', async () => {
    await prisma.company.update({ where: { sourceId: 'la-calandina-s-coop' }, data: { pipelineStage: 'MEETING', priority: 'A', nextAction: 'Trabajo comercial' } });
    await run(process.execPath, [tsx, 'prisma/seed-real.ts'], { env });
    await expect(prisma.company.findUniqueOrThrow({ where: { sourceId: 'la-calandina-s-coop' } })).resolves.toMatchObject({ pipelineStage: 'MEETING', nextAction: 'Trabajo comercial' });
  }, 30_000);
  it('elimina tareas al borrar empresa y bloquea tareas suprimidas', async () => {
    const company = await prisma.company.findUniqueOrThrow({ where: { sourceId: 'la-calandina-s-coop' } });
    const task = await prisma.task.create({ data: { companyId: company.id, type: 'CALL', title: 'Prueba', dueAt: new Date() } });
    await prisma.company.delete({ where: { id: company.id } });
    await expect(prisma.task.findUnique({ where: { id: task.id } })).resolves.toBeNull();
    await prisma.suppressionList.upsert({ where: { email: 'blocked@example.test' }, update: { companyId: null }, create: { email: 'blocked@example.test', reason: 'Prueba' } });
  });
  it('pausar una cadencia cancela sus tareas pendientes futuras', async () => {
    await run(process.execPath, [tsx, 'prisma/seed-real.ts'], { env });
    const company = await prisma.company.findUniqueOrThrow({ where: { sourceId: 'la-calandina-s-coop' } });
    const cadence = await prisma.companyCadence.findFirstOrThrow({ where: { companyId: company.id } });
    await prisma.$transaction((tx) => setCompanyCadenceStatus(tx, cadence.id, 'PAUSED'));
    await expect(prisma.task.count({ where: { companyCadenceId: cadence.id, status: 'PENDING', dueAt: { gt: new Date() } } })).resolves.toBe(0);
  }, 30_000);
  it.each(['Contactado', 'No contesta', 'Buzón', 'Interesado', 'Reunión agendada', 'No interesado', 'Baja'])('registra el resultado %s', async (result) => {
    await run(process.execPath, [tsx, 'prisma/seed-real.ts'], { env });
    const company = await prisma.company.findUniqueOrThrow({ where: { sourceId: 'cooperativa-ganadera-de-caspe' } });
    const task = await prisma.task.create({ data: { companyId: company.id, type: 'CALL', title: `Resultado ${result}`, dueAt: new Date('2026-11-23T00:00:00.000Z') } });
    await completeTask(prisma, task.id, result);
    await expect(prisma.task.findUniqueOrThrow({ where: { id: task.id } })).resolves.toMatchObject({ status: 'COMPLETED', result });
    if (result === 'Reunión agendada') await expect(prisma.company.findUniqueOrThrow({ where: { id: company.id } })).resolves.toMatchObject({ pipelineStage: 'MEETING' });
  }, 30_000);
  it('rechaza un segundo resultado de la misma tarea', async () => {
    await run(process.execPath, [tsx, 'prisma/seed-real.ts'], { env });
    const task = await prisma.task.findFirstOrThrow({ where: { status: 'PENDING' } });
    await completeTask(prisma, task.id, 'Contactado');
    await expect(completeTask(prisma, task.id, 'Contactado')).rejects.toThrow('ya fue procesada');
  }, 30_000);
});
