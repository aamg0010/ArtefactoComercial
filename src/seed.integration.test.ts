import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const enabled = Boolean(process.env.DATABASE_URL);
const prisma = new PrismaClient();
const env = { ...process.env, SEED_ADMIN_PASSWORD: 'integration-admin', SEED_SALES_PASSWORD: 'integration-sales' };
const tsx = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

describe.runIf(enabled)('seed e importación de hoja', () => {
  afterAll(async () => prisma.$disconnect());
  it('es idempotente: conserva 56 empresas, 5 guiones y 121 oportunidades', async () => {
    await run(process.execPath, [tsx, 'prisma/seed-real.ts'], { env });
    await run(process.execPath, [tsx, 'prisma/seed-real.ts'], { env });
    await expect(prisma.company.count()).resolves.toBe(56);
    await expect(prisma.script.count()).resolves.toBe(5);
    await expect(prisma.opportunity.count()).resolves.toBe(121);
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
});
