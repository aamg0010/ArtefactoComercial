import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { backfillCompanies } from '../src/lib/trygestion/outbox';
loadEnvConfig(process.cwd());
const db = new PrismaClient();
const index = process.argv.indexOf('--company');
backfillCompanies(db, index >= 0 ? process.argv[index + 1] : undefined).then(count => console.log(`Empresas encoladas (idempotente): ${count}`)).catch(() => { console.error('BACKFILL_FAILED'); process.exitCode = 1; }).finally(() => db.$disconnect());
