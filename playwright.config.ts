import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { e2eEnvironment } from './e2e/environment';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  globalTeardown: './e2e/global-teardown.ts',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && node scripts/e2e-start-server.cjs',
    url: 'http://localhost:3100/login',
    env: {
      ...e2eEnvironment,
      E2E_SERVER_PID_FILE: join(process.cwd(), '.cache', `e2e-server-${randomUUID()}.json`),
    },
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
