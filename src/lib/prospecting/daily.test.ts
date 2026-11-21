import { afterEach, expect, it, vi } from 'vitest';
import type { PrismaClient, SourceRun } from '@prisma/client';
import { runDailyProspecting } from './daily';

afterEach(() => vi.unstubAllEnvs());
it('el diario no inicia investigación cuando la IA está simulada', async () => {
  vi.stubEnv('LLM_PROVIDER', 'mock');
  const prospect = vi.fn().mockResolvedValue([{ created: 3, errors: 0 }] as SourceRun[]); const research = vi.fn();
  expect(await runDailyProspecting({} as PrismaClient, { prospect, research })).toMatchObject({ created: 3, researchDeferred: true, research: null });
  expect(research).not.toHaveBeenCalled();
});
it('con IA real sólo solicita la investigación de la cola pendiente', async () => {
  vi.stubEnv('LLM_PROVIDER', 'openai'); vi.stubEnv('OPENAI_API_KEY', 'fake-key');
  const db = {} as PrismaClient; const prospect = vi.fn().mockResolvedValue([]); const research = vi.fn().mockResolvedValue({ attempted: 2, succeeded: 2, failed: 0 });
  expect(await runDailyProspecting(db, { prospect, research })).toMatchObject({ researchDeferred: false, research: { succeeded: 2 } });
  expect(research).toHaveBeenCalledWith(db, { queuedOnly: true });
});
