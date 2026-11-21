import { expect, test } from '@playwright/test';
import { e2eDatabaseUrl, e2eEnvironment } from './environment';
import { PrismaClient } from '@prisma/client';

let offlineCompany: { id: string; website: string | null; normalizedDomain: string | null } | undefined;
test.beforeAll(async () => {
  // Keep the existing offline research workflow deterministic after the seed
  // starts inferring websites. Verify the inferred value before this fixture.
  const db = new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl } } });
  try {
    const company = await db.company.findUniqueOrThrow({ where: { sourceId: 'pretersa-prenavisa' } });
    expect(company.website).toBe('https://pretersa.com');
    offlineCompany = { id: company.id, website: company.website, normalizedDomain: company.normalizedDomain };
    await db.company.update({ where: { id: company.id }, data: { website: null, normalizedDomain: null } });
  } finally { await db.$disconnect(); }
});
test.afterAll(async () => {
  if (!offlineCompany) return;
  const db = new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl } } });
  try {
    await db.company.update({ where: { id: offlineCompany.id }, data: { website: offlineCompany.website, normalizedDomain: offlineCompany.normalizedDomain } });
  } finally { await db.$disconnect(); }
});

test('Limabril muestra su web y no presenta un contacto sin canal como verificado', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('comercial@try.company');
  await page.getByLabel('Contraseña', { exact: true }).fill(e2eEnvironment.SEED_SALES_PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:3100/');
  await page.getByRole('link', { name: 'Limabril S.L.', exact: true }).click();
  const data = page.getByRole('region', { name: 'Datos de empresa', exact: true });
  await expect(data).toContainText('https://limabril.com');
  await expect(data).toContainText('Sin canal de contacto directo');
  await expect(data).toContainText('Pendiente de verificar');
  await expect(data).not.toContainText('Verificado');
});

test('Pretersa: investigar, puntuar, generar borrador, aprobar y ver tareas', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('comercial@try.company');
  await page.getByLabel('Contraseña', { exact: true }).fill(e2eEnvironment.SEED_SALES_PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:3100/');
  await page.getByRole('link', { name: /Pretersa.*Prenavisa/i }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Pretersa.*Prenavisa/i);
  await expect(page.getByText('IA en modo simulado', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Investigar', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Puntuación', exact: true })).toContainText(/Puntuación: \d+\/100/);
  await expect(page.getByRole('region', { name: 'Investigación', exact: true })).toContainText('Sin web');
  await page.getByRole('button', { name: 'Generar guion', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Guion versión.*BORRADOR/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Guiones', exact: true })).toContainText('BAJA');
  await page.getByRole('button', { name: 'Aprobar guion', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Guion versión.*Aprobado/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aprobar guion', exact: true })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: 'Mi día', exact: true }).click();
  // Use a future view to include its seeded next-action date without a fixed sleep.
  await page.goto('/mi-dia?fecha=2026-12-31');
  const tasks = page.getByRole('article').filter({ has: page.getByRole('heading', { name: /Pretersa.*Prenavisa/i }) });
  await expect(tasks.filter({ hasText: 'Guion y emails' })).toHaveCount(6);
  await tasks.filter({ hasText: 'Guion y emails' }).first().getByText('Guion y emails', { exact: true }).click();
  await expect(tasks.filter({ hasText: 'Guion y emails' }).first().getByText('Pregunta clave:', { exact: true })).toBeVisible();
});
