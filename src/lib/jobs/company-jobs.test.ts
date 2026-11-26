import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../prisma', () => ({ prisma: { auditLog: { create: vi.fn() } } }));
import { prisma } from '../prisma';
import { companyJobState, isCompanyJobRunning, startCompanyJob } from './company-jobs';
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it('deduplica por tipo y empresa, guarda versión y limpia al acabar', async () => {
  vi.useFakeTimers();
  const fn = vi.fn(() => new Promise<{ version: number }>(resolve => setTimeout(() => resolve({ version: 4 }), 2000)));
  expect(startCompanyJob('script', 'dedup', 'sales', fn)).toBe('started');
  expect(startCompanyJob('script', 'dedup', 'sales', fn)).toBe('already-running');
  expect(isCompanyJobRunning('script', 'dedup')).toBe(true);
  await vi.advanceTimersByTimeAsync(2000);
  expect(fn).toHaveBeenCalledTimes(1);
  expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'SCRIPT_GENERATED', entityId: 'dedup', userId: 'sales', metadata: { version: 4, durationMs: 2000 } }) });
  expect(isCompanyJobRunning('script', 'dedup')).toBe(false);
});
it('registra fallos sin guardar mensajes privados', async () => {
  vi.useFakeTimers();
  startCompanyJob('research', 'fail', 'sales', async () => { throw new Error('texto privado'); });
  await vi.advanceTimersByTimeAsync(0);
  expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'RESEARCH_FAILED', metadata: { errorCode: 'JOB_FAILED', durationMs: 0 } }) });
  expect(isCompanyJobRunning('research', 'fail')).toBe(false);
});
it('limita el tiempo, aborta y absorbe rechazos tardíos sin segundo resultado', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  let rejectLate!: (error: Error) => void;
  startCompanyJob('script', 'timeout', 'sales', s => { signal = s; return new Promise((_, reject) => { rejectLate = reject; }); }, { timeoutMs: 100 });
  await vi.advanceTimersByTimeAsync(100);
  expect(signal?.aborted).toBe(true);
  expect(isCompanyJobRunning('script', 'timeout')).toBe(false);
  expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'SCRIPT_GENERATION_FAILED', metadata: { errorCode: 'JOB_TIMEOUT', durationMs: 100 } }) });
  rejectLate(new Error('late'));
  await vi.advanceTimersByTimeAsync(1);
  expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
});
it('calcula en curso, listo, fallo reciente, resultado superado y reinicio sin resultado', () => {
  const now = Date.now(); const date = new Date(now);
  expect(companyJobState('script', true, undefined, null, now)).toBe('running');
  expect(companyJobState('script', false, date, { action: 'SCRIPT_GENERATED', createdAt: date }, now)).toBe('ready');
  expect(companyJobState('script', false, undefined, { action: 'SCRIPT_GENERATION_FAILED', createdAt: date }, now)).toBe('failed');
  expect(companyJobState('script', false, new Date(now + 1), { action: 'SCRIPT_GENERATION_FAILED', createdAt: date }, now)).toBe('idle');
  expect(companyJobState('script', false, undefined, null, now)).toBe('idle');
  expect(companyJobState('research', false, undefined, { action: 'RESEARCH_FAILED', createdAt: new Date(now - 900001) }, now)).toBe('idle');
});
