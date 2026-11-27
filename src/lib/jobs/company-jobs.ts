import { prisma } from '../prisma';

export type CompanyJobType = 'research' | 'script';
const actions = { script: ['SCRIPT_GENERATED', 'SCRIPT_GENERATION_FAILED'], research: ['RESEARCH_DONE', 'RESEARCH_FAILED'] } as const;
type Job = { startedAt: number };
// Compartido entre los bundles de las acciones y de la página en el único proceso Node.
const scope = globalThis as typeof globalThis & { companyJobs?: Map<string, Job> };
const jobs = scope.companyJobs ??= new Map<string, Job>();
export function isCompanyJobRunning(type: CompanyJobType, companyId: string) {
  return jobs.has(`${type}:${companyId}`);
}

export function startCompanyJob(type: CompanyJobType, companyId: string, userId: string,
  fn: (signal: AbortSignal) => Promise<{ version: number }>,
  options: { timeoutMs?: number; db?: Pick<typeof prisma, 'auditLog'> } = {}) {
  const key = `${type}:${companyId}`;
  if (jobs.has(key)) return 'already-running' as const;
  const job = { startedAt: Date.now() };
  jobs.set(key, job);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('JOB_TIMEOUT')); }, options.timeoutMs ?? 360_000);
  });
  void (async () => {
    let action: string = actions[type][0];
    let metadata: { version: number } | { errorCode: string };
    try {
      const result = await Promise.race([Promise.resolve().then(() => fn(controller.signal)), timeout]);
      metadata = { version: result.version };
    } catch (error) {
      action = actions[type][1];
      const code = error instanceof Error ? error.message : '';
      metadata = { errorCode: ['JOB_TIMEOUT', 'VALIDATION_ERROR', 'INVALID_JSON', 'PROVIDER_ERROR'].includes(code) ? code : 'JOB_FAILED' };
    } finally { clearTimeout(timer!); }
    try {
      await (options.db ?? prisma).auditLog.create({ data: { entityType: 'Company', entityId: companyId, userId, action, metadata: { ...metadata, durationMs: Date.now() - job.startedAt } } });
    } finally { if (jobs.get(key) === job) jobs.delete(key); }
  })().catch(() => { console.error('COMPANY_JOB_AUDIT_FAILED'); });
  return 'started' as const;
}

export type CompanyJobState = 'running' | 'ready' | 'failed' | 'idle';
export function companyJobState(type: CompanyJobType, running: boolean, latestCreatedAt: Date | undefined,
  result: { action: string; createdAt: Date } | null, now = Date.now()): CompanyJobState {
  if (running) return 'running';
  if (!result || now - result.createdAt.getTime() > 15 * 60_000) return 'idle';
  if (result.action === actions[type][1]) return !latestCreatedAt || result.createdAt >= latestCreatedAt ? 'failed' : 'idle';
  return result.action === actions[type][0] ? 'ready' : 'idle';
}
