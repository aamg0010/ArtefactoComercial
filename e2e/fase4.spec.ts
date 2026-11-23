import { expect, test } from '@playwright/test';
import { e2eEnvironment } from './environment';
import { e2eDatabaseUrl } from './environment';
import { PrismaClient } from '@prisma/client';

test('crear y ejecutar un perfil simulado, ver detectadas de hoy y abrir su ficha', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('admin@try.company');
  await page.getByLabel('Contraseña', { exact: true }).fill(e2eEnvironment.SEED_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:3100/');
  await page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: 'Rastreo', exact: true }).click();
  await expect(page.getByText('Rastreo en modo simulado', { exact: true })).toBeVisible();
  const form = page.getByRole('region', { name: 'Nuevo perfil', exact: true });
  await form.getByLabel('openstreetmap', { exact: true }).uncheck();
  await form.getByLabel('Nombre del perfil', { exact: true }).fill('Perfil E2E servicios');
  await form.getByLabel('Provincias', { exact: true }).fill('Teruel');
  await form.getByLabel('Municipios', { exact: true }).fill('Alcañiz');
  await form.getByLabel('Comarcas', { exact: true }).fill('Bajo Aragón');
  await form.getByLabel('Sector / palabras clave', { exact: true }).fill('taller');
  await form.getByLabel('Máximo de resultados', { exact: true }).fill('2');
  await form.getByLabel('Activo', { exact: true }).check();
  await form.getByRole('button', { name: 'Crear perfil', exact: true }).click();
  const profile = page.getByRole('article', { name: 'Perfil E2E servicios', exact: true });
  await expect(profile).toBeVisible();
  await profile.getByText('Editar perfil', { exact: true }).click();
  await profile.getByLabel('Códigos CNAE / CIIU (opcional)', { exact: true }).fill('4520');
  await profile.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await profile.getByText('Editar perfil', { exact: true }).click();
  await expect(profile.getByLabel('Códigos CNAE / CIIU (opcional)', { exact: true })).toHaveValue('4520');
  await profile.getByRole('button', { name: 'Desactivar', exact: true }).click();
  await expect(profile.getByRole('button', { name: 'Ejecutar ahora', exact: true })).toBeDisabled();
  await profile.getByRole('button', { name: 'Activar', exact: true }).click();
  await expect(profile.getByRole('button', { name: 'Ejecutar ahora', exact: true })).toBeEnabled();
  await profile.getByRole('button', { name: 'Ejecutar ahora', exact: true }).click();
  const detected = page.getByRole('region', { name: 'Detectadas hoy', exact: true });
  await expect(detected.getByRole('link', { name: /\[SIMULADA\]/ })).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Historial de ejecuciones' })).toContainText('SUCCESS');
  await profile.getByRole('button', { name: 'Ejecutar ahora', exact: true }).click();
  await expect(detected.getByRole('link', { name: /\[SIMULADA\]/ })).toHaveCount(2);
  await detected.getByRole('link', { name: /\[SIMULADA\]/ }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('[SIMULADA]');
  await expect(page.getByRole('region', { name: 'Datos de empresa' })).toContainText('Sin asignar');
});

test('aceptar una empresa de Google simulada con datos propios confirmados', async ({ page }) => {
  const db = new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl } } });
  let id: string;
  try {
    const company = await db.company.create({ data: {
      name: 'Referencia Google simulada E2E', normalizedName: 'referencia google simulada e2e', country: 'ES',
      source: 'GOOGLE_PLACES', fictional: true, acceptanceStatus: 'PENDING', detectedAt: new Date(), pipelineStage: 'DETECTED',
      sourceIdentities: { create: { source: 'google-places', sourceRef: 'google-e2e-acceptance' } },
    } }); id = company.id;
  } finally { await db.$disconnect(); }
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('comercial@try.company');
  await page.getByLabel('Contraseña', { exact: true }).fill(e2eEnvironment.SEED_SALES_PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:3100/');
  await page.goto('/rastreo');
  const pending = page.getByRole('region', { name: 'Pendientes de aceptar', exact: true });
  await pending.getByRole('link', { name: 'Referencia Google simulada E2E', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Investigar', exact: true })).toBeDisabled();
  const acceptance = page.getByRole('region', { name: 'Aceptar empresa', exact: true });
  await expect(acceptance.getByLabel('Nombre confirmado', { exact: true })).toHaveValue('');
  await acceptance.getByLabel('Nombre confirmado', { exact: true }).fill('[SIMULADA] Empresa aceptada E2E');
  await acceptance.getByLabel('Municipio confirmado', { exact: true }).fill('Alcañiz');
  await acceptance.getByLabel('Web confirmada', { exact: true }).fill('https://aceptada.example.invalid');
  await acceptance.getByLabel('Email corporativo confirmado', { exact: true }).fill('info@aceptada.example.invalid');
  await acceptance.getByRole('checkbox').check();
  await acceptance.getByRole('button', { name: 'Aceptar empresa', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('[SIMULADA] Empresa aceptada E2E');
  await expect(page.getByRole('region', { name: 'Datos de empresa' })).toContainText('confirmado manualmente');
  await expect(page.getByRole('button', { name: 'Investigar', exact: true })).toBeEnabled();
  await page.goto('/rastreo');
  await expect(page.getByRole('region', { name: 'Listas para trabajar' }).getByRole('link', { name: '[SIMULADA] Empresa aceptada E2E', exact: true })).toBeVisible();
  await expect(pending.getByRole('link', { name: 'Referencia Google simulada E2E', exact: true })).toHaveCount(0);
  await page.goto('/mi-dia');
  await expect(page.getByRole('heading', { name: /Empresa aceptada E2E/ })).toHaveCount(0);
  const check = new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl } } });
  try { expect(await check.task.count({ where: { companyId: id! } })).toBe(0); } finally { await check.$disconnect(); }
});
