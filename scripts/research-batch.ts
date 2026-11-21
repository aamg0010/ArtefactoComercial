import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { runResearchBatch } from '../src/lib/research/batch';

loadEnvConfig(process.cwd());
const db = new PrismaClient();
async function main() {
  const result = await runResearchBatch(db);
  console.log('Investigación masiva:', result);
  if (result.failed) process.exitCode = 1;
}
main().catch(() => { console.error('Error de investigación masiva'); process.exitCode = 1; }).finally(() => db.$disconnect());
