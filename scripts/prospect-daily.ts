import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { runDailyProspecting } from '../src/lib/prospecting/daily';
import { pauseClosedCycles } from '../src/lib/guia/mutations';

loadEnvConfig(process.cwd());
const db = new PrismaClient();
// La pausa de ciclos (Guía del día) no debe impedir el rastreo diario si falla.
pauseClosedCycles(db).then(result => console.log('Guía del día:', result), () => { console.error('Error al pausar ciclos cerrados (Guía del día); el rastreo sigue.'); process.exitCode = 1; })
  .then(() => runDailyProspecting(db)).then(result => { console.log('Rastreo diario:', result); if (result.errors || result.research?.failed) process.exitCode = 1; })
  .catch(() => { console.error('Error en el rastreo diario; consulta SourceRun.'); process.exitCode = 1; }).finally(() => db.$disconnect());
