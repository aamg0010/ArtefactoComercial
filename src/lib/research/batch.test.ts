import type { PrismaClient } from '@prisma/client';
import { expect, it, vi } from 'vitest';
import { runResearchBatch } from './batch';

it('investiga de tres en tres, pausa entre lotes y no repite las fichas hechas al relanzar', async () => {
  const pending = new Set(['a', 'b', 'c', 'd', 'e']);
  let active = 0; let maximum = 0;
  const findMany = vi.fn(async () => [...pending].map(id => ({ id })));
  const db = { company: { findMany } } as unknown as PrismaClient;
  const investigate = vi.fn(async (_db: PrismaClient, id: string) => {
    active++; maximum = Math.max(maximum, active); await Promise.resolve(); active--; pending.delete(id);
  });
  const pause = vi.fn().mockResolvedValue(undefined);
  expect(await runResearchBatch(db, { investigate, pause })).toEqual({ attempted: 5, succeeded: 5, failed: 0 });
  expect(maximum).toBe(3); expect(pause).toHaveBeenCalledWith(1000); expect(pause).toHaveBeenCalledTimes(1);
  expect(await runResearchBatch(db, { investigate, pause })).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
  expect(investigate).toHaveBeenCalledTimes(5);
  expect(findMany).toHaveBeenCalledWith({ where: { researchReports: { none: { origin: 'AI' } } }, select: { id: true }, orderBy: { id: 'asc' } });
});
it('un error en una empresa no cancela las otras del lote', async () => {
  const db = { company: { findMany: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]) } } as unknown as PrismaClient;
  const investigate = vi.fn(async (_db: PrismaClient, id: string) => { if (id === 'a') throw new Error('fallo'); });
  expect(await runResearchBatch(db, { investigate })).toEqual({ attempted: 2, succeeded: 1, failed: 1 });
  expect(investigate).toHaveBeenCalledTimes(2);
});
