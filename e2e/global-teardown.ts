import { readFile, rm } from 'node:fs/promises';
import type { FullConfig } from '@playwright/test';

export default async function teardown(config: FullConfig) {
  // The random file belongs to the server launched by this run, never to a
  // pre-existing server. No process enumeration or elevated taskkill is needed.
  const pidFile = config.webServer?.env?.E2E_SERVER_PID_FILE;
  if (!pidFile) return;
  try {
    const { pid } = JSON.parse(await readFile(pidFile, 'utf8')) as { pid: number };
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('PID E2E inválido.');
    try { process.kill(pid); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  } finally {
    await rm(pidFile, { force: true });
  }
}
