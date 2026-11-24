import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { processSyncOutbox } from '../src/lib/trygestion/sync';
import { syncEmailReplies } from '../src/lib/trygestion/replies';
loadEnvConfig(process.cwd());
const db = new PrismaClient();
const index = process.argv.indexOf('--company');
processSyncOutbox(db, { companyId: index >= 0 ? process.argv[index + 1] : undefined, limit: 100 }).then(async result => console.log(JSON.stringify({ ...result, replies: await syncEmailReplies(db) }))).catch(() => { console.error('SYNC_FAILED'); process.exitCode = 1; }).finally(() => db.$disconnect());
