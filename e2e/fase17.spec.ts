import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { e2eDatabaseUrl, e2eEnvironment } from './environment';

test('aceptada sin web: propone desde su web simulada, guarda y permite investigar', async ({ page }) => {
  const db = new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl } } });
  const id = 'fase17-complete-web';
  try {
    await db.company.create({ data: { id, name: '[SIMULADA] Completar web Fase17', normalizedName: 'simulada completar web fase17', country: 'ES', fictional: true, acceptanceStatus: 'ACCEPTED', sourceIdentities: { create: { source: 'google-places', sourceRef: 'google-e2e-complete-web' } } } });
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('comercial@try.company');
    await page.getByLabel('Contraseña', { exact: true }).fill(e2eEnvironment.SEED_SALES_PASSWORD);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL('http://localhost:3100/');
    await page.goto(`/empresas/${id}`);
    await page.getByRole('link', { name: 'Completar datos desde su web', exact: true }).click();
    const form = page.getByRole('region', { name: 'Propuesta de la web propia' });
    await expect(form.getByLabel('Web confirmada', { exact: true })).toHaveValue('https://completar.example.invalid/');
    await expect(form.getByLabel('Email corporativo confirmado', { exact: true })).toHaveValue('info@completar.example.invalid');
    await expect(form.getByLabel('Teléfono corporativo confirmado', { exact: true })).toHaveValue('');
    await form.getByRole('checkbox').check();
    await form.getByRole('button', { name: 'Guardar datos', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Datos completados desde su web.' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Datos de empresa', exact: true }).getByRole('link', { name: 'https://completar.example.invalid', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Investigar', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Investigar', exact: true })).toBeInViewport();
    const company = await db.company.findUniqueOrThrow({ where: { id }, include: { evidence: true } });
    expect(company.website).toBe('https://completar.example.invalid/'); expect(company.phone).toBeNull();
    expect(company.evidence[0].kind).toBe('WEB_OWN');
  } finally { await db.company.deleteMany({ where: { id } }); await db.$disconnect(); }
});

test('un error de página muestra un mensaje amable y Reintentar', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('comercial@try.company');
  await page.getByLabel('Contraseña', { exact: true }).fill(e2eEnvironment.SEED_SALES_PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:3100/');
  // Missing company exercises the real production error boundary without a special route.
  await page.goto('/empresas/fase17-error/completar');
  await expect(page.getByRole('alert').filter({ hasText: 'Ha ocurrido un problema.' })).toContainText('Puedes volver a intentarlo.');
  await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toBeVisible();
});

test('acción de otro despliegue recarga una sola vez y evita bucles', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('comercial@try.company');
  await page.getByLabel('Contraseña', { exact: true }).fill(e2eEnvironment.SEED_SALES_PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:3100/');
  const loaded = page.waitForEvent('load');
  // This unknown action yields Next's HTML fallback, without executing any mutation.
  await page.evaluate(() => { void fetch(window.location.href, { method: 'POST', headers: { 'Next-Action': 'old-deployment-action', Accept: 'text/x-component' }, body: '[]' }); });
  await loaded;
  expect(await page.evaluate(() => sessionStorage.getItem('try-comercial:deployment-reloaded'))).toBe('1');
  await page.evaluate(() => { window.dispatchEvent(new ErrorEvent('error', { message: 'ChunkLoadError: Loading chunk 17 failed.' })); });
  await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Ha ocurrido un problema.' })).toContainText('Puedes volver a intentarlo');
});
