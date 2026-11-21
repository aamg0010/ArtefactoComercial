import { isSafeTestDatabase } from '../src/lib/test-database';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

export const e2eDatabaseUrl = process.env.E2E_DATABASE_URL ??
  'postgresql://try:try@localhost:54329/try_comercial_e2e?schema=public';

if (!isSafeTestDatabase(e2eDatabaseUrl, process.env.DATABASE_URL, '_e2e')) {
  throw new Error('E2E_DATABASE_URL debe ser distinta de la base de trabajo y terminar en _e2e.');
}

export const e2eEnvironment = {
  DATABASE_URL: e2eDatabaseUrl,
  AUTH_SECRET: 'try-comercial-e2e-only-secret-at-least-32-characters',
  AUTH_URL: 'http://localhost:3100',
  AUTH_TRUST_HOST: 'true',
  SEED_ADMIN_PASSWORD: 'e2e-admin-only-password',
  SEED_SALES_PASSWORD: 'e2e-sales-only-password',
  LLM_PROVIDER: 'mock',
  LLM_MODEL: '',
  ANTHROPIC_API_KEY: '',
  OPENAI_API_KEY: '',
};
