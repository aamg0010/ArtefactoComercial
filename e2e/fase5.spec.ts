import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { e2eDatabaseUrl, e2eEnvironment } from './environment';
import { startTrygestionMock } from '../src/lib/trygestion/testing/mock-server';

test('integración: estado de trygestión, procesar la cola y ver la empresa enlazada', async ({ page }) => {
  const mock = await startTrygestionMock(3199);
  const db = new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl } } });
  try {
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('admin@try.company');
    await page.getByLabel('Contraseña', { exact: true }).fill(e2eEnvironment.SEED_ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL('http://localhost:3100/');
    await page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: 'Integración', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Activada · Tenant: Tenant de pruebas local' })).toBeVisible();
    const queue = page.getByRole('region', { name: 'Cola de sincronización' });
    // The seed enqueues every accepted company (initial load of the 56).
    expect(Number(await queue.locator('[data-status="PENDING"]').innerText())).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Procesar ahora', exact: true }).click();
    await expect.poll(async () => Number(await page.locator('[data-status="DONE"]').innerText())).toBeGreaterThan(0);
    expect(mock.state.companies.length).toBeGreaterThan(0);
    expect(mock.state.opportunities.every(row => row.etapa_id === 'stage-1')).toBe(true);
    const linked = await db.company.findFirstOrThrow({ where: { trygestionEmpresaId: { not: null } } });
    await page.goto(`/empresas/${linked.id}`);
    await expect(page.getByText(`En trygestión · ${linked.trygestionEmpresaId}`)).toBeVisible();
  } finally {
    await db.$disconnect(); await mock.close();
  }
});

test('la página de baja es pública y rechaza enlaces no válidos', async ({ page }) => {
  await page.goto('/baja/enlace-no-valido');
  await expect(page.getByText('El enlace no es válido o ha caducado.')).toBeVisible();
});
