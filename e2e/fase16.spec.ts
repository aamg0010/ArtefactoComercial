import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { spawn, type ChildProcess } from 'node:child_process';
import { e2eDatabaseUrl, e2eEnvironment } from './environment';

const db = new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl } } });
const provisional = 'Empresa detectada · Perfil fase16 · ChIJfase16live';
let server: ChildProcess;
test.beforeAll(async () => {
  for (const [id, ref] of [['fase16-live', 'ChIJfase16live'], ['fase16-fail', 'ChIJfase16fail']]) {
    await db.company.create({ data: {
      id, name: id === 'fase16-live' ? provisional : `Empresa detectada · Perfil fallo fase16 · ${ref}`,
      normalizedName: id, country: 'ES', source: 'GOOGLE_PLACES', acceptanceStatus: 'PENDING',
      sourceDetail: `google-places: ${ref}`, detectedAt: new Date(),
      sourceIdentities: { create: { source: 'google-places', sourceRef: ref } },
    } });
  }
  server = spawn(process.execPath, ['--require', './e2e/google-places-fetch.cjs', 'node_modules/next/dist/bin/next', 'start', '-p', '3101'], {
    env: { ...process.env, ...e2eEnvironment, GOOGLE_PLACES_API_KEY: 'fake-e2e-never-real', AUTH_URL: 'http://localhost:3101' },
    stdio: 'ignore', windowsHide: true,
  });
  await expect.poll(async () => {
    try { return (await fetch('http://localhost:3101/login')).status; } catch { return 0; }
  }, { timeout: 30_000 }).toBe(200);
});
test.afterAll(async () => {
  server?.kill();
  await db.company.deleteMany({ where: { id: { in: ['fase16-live', 'fase16-fail'] } } });
  await db.$disconnect();
});

for (const port of [3100, 3101]) test(`nombres temporales sin persistir, lista y ficha, servidor ${port}`, async ({ page }) => {
  test.setTimeout(60_000);
  const base = `http://localhost:${port}`;
  await page.route('https://**/*', route => route.abort());
  await page.goto(`${base}/login`);
  await page.getByLabel('Email', { exact: true }).fill('admin@try.company');
  await page.getByLabel('Contraseña', { exact: true }).fill(e2eEnvironment.SEED_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(`${base}/`);
  await page.goto(`${base}/?mostrar=all&q=Perfil fase16`);
  const label = port === 3101 ? 'Construcciones Bajo Aragón E2E' : 'Pendiente de verificar · Perfil fase16';
  await expect(page.locator('main')).toContainText(label);
  await expect(page.locator('body')).not.toContainText('ChIJ');
  if (port === 3101) await expect(page.getByText('Sin verificar · Google Maps', { exact: true }).last()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('link', { name: label, exact: false }).first()).toBeVisible();
  await page.goto(`${base}/empresas/fase16-live`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(label);
  await expect(page.locator('body')).not.toContainText('ChIJ');
  if (port === 3101) await expect(page.getByRole('heading', { level: 1 })).toContainText('Sin verificar · Google Maps');
  await expect(page.getByLabel('Nombre confirmado', { exact: true })).toHaveValue('');
  expect((await db.company.findUniqueOrThrow({ where: { id: 'fase16-live' } })).name).toBe(provisional);
  await page.goto(`${base}/?mostrar=all&q=Perfil fallo fase16`);
  await expect(page.locator('main')).toContainText('Pendiente de verificar · Perfil fallo fase16');
  await expect(page.locator('body')).not.toContainText('ChIJ');
  await page.goto(`${base}/empresas/fase16-fail`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pendiente de verificar · Perfil fallo fase16');
  await expect(page.locator('body')).not.toContainText('ChIJ');
});
