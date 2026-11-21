import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { runDailyProspecting } from '../src/lib/prospecting/daily';

loadEnvConfig(process.cwd());
const db = new PrismaClient();
runDailyProspecting(db).then(result => { console.log('Rastreo diario:', result); if (result.errors || result.research?.failed) process.exitCode = 1; })
  .catch(() => { console.error('Error en el rastreo diario; consulta SourceRun.'); process.exitCode = 1; }).finally(() => db.$disconnect());
