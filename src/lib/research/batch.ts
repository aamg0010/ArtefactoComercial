import type { PrismaClient } from '@prisma/client';
import { setTimeout as wait } from 'node:timers/promises';
import { investigateCompany } from './service';

export async function runResearchBatch(db: PrismaClient, dependencies: {
  investigate?: (db: PrismaClient, id: string) => Promise<unknown>;
  pause?: (ms: number) => Promise<unknown>;
} = {}) {
  const companies = await db.company.findMany({ where: { researchReports: { none: { origin: 'AI' } } }, select: { id: true }, orderBy: { id: 'asc' } });
  const result = { attempted: companies.length, succeeded: 0, failed: 0 };
  for (let offset = 0; offset < companies.length; offset += 3) {
    const outcomes = await Promise.allSettled(companies.slice(offset, offset + 3).map(company => (dependencies.investigate ?? investigateCompany)(db, company.id)));
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') result.succeeded++;
      else result.failed++;
    }
    if (offset + 3 < companies.length) await (dependencies.pause ?? wait)(1000);
  }
  return result;
}
