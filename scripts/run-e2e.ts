import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { e2eDatabaseUrl, e2eEnvironment } from '../e2e/environment';

const env = { ...process.env, ...e2eEnvironment };
function execute(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolve() :
      reject(new Error(`El subproceso terminó con ${signal ?? code}.`)));
  });
}

async function main() {
  // The environment module validates the target before any connection is opened.
  const adminUrl = new URL(e2eDatabaseUrl);
  const name = decodeURIComponent(adminUrl.pathname.slice(1));
  if (!/^[a-zA-Z0-9_]+_e2e$/.test(name)) throw new Error('Nombre de base E2E inválido.');
  adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    const databases = await admin.$queryRaw<{ datname: string }[]>`SELECT datname FROM pg_database WHERE datname = ${name}`;
    if (!databases.length) await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.$disconnect();
  }

  await execute(['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
  const db = new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl } } });
  try {
    await db.$transaction([
      db.emailReply.deleteMany(), db.emailReplySync.deleteMany(), db.syncOutbox.deleteMany(), db.emailDispatch.deleteMany(),
      db.activity.deleteMany(), db.task.deleteMany(), db.companyCadence.deleteMany(),
      db.suppressionList.deleteMany(), db.company.deleteMany(),
      db.cadenceStep.deleteMany(), db.cadence.deleteMany(),
      db.companySource.deleteMany(), db.sourceRun.deleteMany(), db.searchProfile.deleteMany(),
    ]);
  } finally {
    await db.$disconnect();
  }
  await execute(['scripts/run-typescript.cjs', 'prisma/seed-real.ts']);
  console.log(`Base E2E preparada: ${name}.`);
  // Do not replace the parent process's DATABASE_URL: Playwright's safety guard
  // must compare E2E_DATABASE_URL against the original working configuration.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)], {
      env: {
        ...process.env, E2E_DATABASE_URL: e2eDatabaseUrl,
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(process.cwd(), '.cache', 'ms-playwright'),
      }, stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Playwright terminó con código ${code}.`)));
  });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
