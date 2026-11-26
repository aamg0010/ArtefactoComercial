import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), barrier: vi.fn(), generate: vi.fn(), research: vi.fn(), audit: vi.fn(), company: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/prisma', () => ({ prisma: { company: { findFirstOrThrow: mocks.company }, auditLog: { create: mocks.audit } } }));
vi.mock('@/lib/contact-status-service', () => ({ enforceContactBarrier: mocks.barrier }));
vi.mock('@/lib/research/service', () => ({ generateCompanyScript: mocks.generate, investigateCompany: mocks.research }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(url); } }));
import { companyAction } from './actions';
import { isCompanyJobRunning } from '@/lib/jobs/company-jobs';
beforeEach(() => { vi.useFakeTimers(); mocks.auth.mockResolvedValue({ user: { id: 'sales', role: 'SALES' } }); });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it.each(['generate', 'research'])('%s redirige antes de resolver la IA lenta', async action => {
  const slow = vi.fn(() => new Promise<{ version: number }>(resolve => setTimeout(() => resolve({ version: 1 }), 80000)));
  mocks.generate.mockImplementation(slow); mocks.research.mockImplementation(slow);
  const form = new FormData(); form.set('companyId', `slow-${action}`); form.set('action', action); form.set('product', 'Athenea');
  await expect(companyAction(form)).rejects.toThrow(`ok=${action === 'generate' ? 'generando' : 'investigando'}`);
  expect(isCompanyJobRunning(action === 'generate' ? 'script' : 'research', `slow-${action}`)).toBe(true);
  expect(mocks.audit).not.toHaveBeenCalled();
  if (action === 'generate') expect(mocks.barrier).toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(80000);
  expect(mocks.audit).toHaveBeenCalled();
});
it('rechaza DIRECTOR antes de lanzar trabajos', async () => {
  mocks.auth.mockResolvedValue({ user: { id: 'director', role: 'DIRECTOR' } });
  await expect(companyAction(new FormData())).rejects.toThrow('No autorizado');
  expect(mocks.generate).not.toHaveBeenCalled();
});
it('rechaza la barrera antes de iniciar la IA', async () => {
  mocks.barrier.mockRejectedValueOnce(new Error('bloqueada'));
  const form = new FormData(); form.set('companyId', 'blocked'); form.set('action', 'generate'); form.set('product', 'Athenea');
  await expect(companyAction(form)).rejects.toThrow('error=1');
  expect(mocks.generate).not.toHaveBeenCalled();
});
