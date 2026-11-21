import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
const test = 'postgresql://try:try@localhost:54329/try_comercial_test?schema=public';
const shadow = 'postgresql://try:try@localhost:54329/try_comercial_shadow?schema=public';
async function main() {
  const admin = new PrismaClient({ datasources: { db: { url: 'postgresql://try:try@localhost:54329/postgres' } } });
  try { for (const name of ['try_comercial_test', 'try_comercial_shadow']) { const exists = await admin.$queryRaw<{ datname: string }[]>`SELECT datname FROM pg_database WHERE datname = ${name}`; if (!exists.length) await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`); } } finally { await admin.$disconnect(); }
  const directory = 'prisma/migrations/20261121190000_trygestion_outbox'; await mkdir(directory, { recursive: true });
  // Empty migration is a valid diff input while its generated SQL is written.
  await writeFile(`${directory}/migration.sql`, '', 'utf8');
  const execute = (args: string[]) => new Promise<void>((resolve, reject) => { const child = spawn(process.execPath, ['node_modules/prisma/build/index.js', ...args], { env: { ...process.env, DATABASE_URL: test }, stdio: 'inherit' }); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Prisma: ${code}`))); });
  await execute(['migrate', 'diff', '--from-migrations', 'prisma/migrations', '--to-schema-datamodel', 'prisma/schema.prisma', '--shadow-database-url', shadow, '--script', '--output', `${directory}/migration.sql`]);
  await execute(['migrate', 'deploy']);
  await execute(['migrate', 'diff', '--from-migrations', 'prisma/migrations', '--to-schema-datamodel', 'prisma/schema.prisma', '--shadow-database-url', shadow, '--exit-code']);
}
main().catch(() => { console.error('MIGRATION_FAILED'); process.exitCode = 1; });
