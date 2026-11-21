import type { PrismaClient } from '@prisma/client';
import { llmConfiguration } from '../llm';
import { runResearchBatch } from '../research/batch';
import { runProspecting } from './service';

export async function runDailyProspecting(db: PrismaClient, dependencies: {
  prospect?: typeof runProspecting; research?: typeof runResearchBatch;
} = {}) {
  const runs = await (dependencies.prospect ?? runProspecting)(undefined, { db });
  const simulated = llmConfiguration().simulated;
  const research = simulated ? null : await (dependencies.research ?? runResearchBatch)(db, { queuedOnly: true });
  return { profiles: runs.length, created: runs.reduce((total, run) => total + run.created, 0), errors: runs.reduce((total, run) => total + run.errors, 0), researchDeferred: simulated, research };
}
