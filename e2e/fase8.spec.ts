import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { e2eDatabaseUrl, e2eEnvironment } from './environment';
import { madridDate } from '../src/lib/dates';

test('preparar el email elegido y filtrar Mi día mediante GET sin JavaScript', async ({ page, browser }) => {
  const db = new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl } } });
  const companyId = 'fase8-e2e-empresa';
  try {
    await db.company.deleteMany({ where: { id: companyId } });
    await db.company.create({ data: {
      id: companyId, name: '[SIMULADA] Bodega Ávila Fase8', normalizedName: 'simulada bodega avila fase8', country: 'ES', fictional: true, email: 'info@fase8.example.invalid', priority: 'A',
      scripts: { create: { id: 'fase8-e2e-guion', author: 'Prueba E2E', status: 'APPROVED', content: { producto_principal: 'Athenea', emails: [{ dia: 1, asunto: 'Email primero Fase8', cuerpo: 'Cuerpo primero' }, { dia: 6, asunto: 'Email elegido Fase8', cuerpo: 'Cuerpo elegido [TELÉFONO] [WEB] BAJA' }] } } },
      tasks: { create: { type: 'CALL', title: 'Llamar Fase8', dueAt: new Date(`${madridDate()}T00:00:00Z`) } },
    } });
    await page.route(/https?:\/\/([^/]+\.)?(trygestion\.com|trycompany\.es)(\/|$)/, route => route.abort());
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('comercial@try.company');
    await page.getByLabel('Contraseña', { exact: true }).fill(e2eEnvironment.SEED_SALES_PASSWORD);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL('http://localhost:3100/');
    await page.goto(`/empresas/${companyId}`);
    await page.getByRole('button', { name: 'Enviar desde Mi día', exact: true }).nth(1).click();
    await expect(page).toHaveURL(/\/mi-dia\?tarea=[\w-]+#tarea-[\w-]+$/);
    const prepared = page.getByRole('region', { name: 'Email preparado', exact: true });
    await expect(prepared).toContainText('Email preparado desde la ficha de [SIMULADA] Bodega Ávila Fase8');
    await expect(prepared.getByLabel('Asunto', { exact: true })).toHaveValue('Email elegido Fase8');
    await expect(prepared.getByLabel('Cuerpo', { exact: true })).toHaveValue('Cuerpo elegido [TELÉFONO] [WEB] BAJA');
    await expect(prepared.getByLabel('Destinatario corporativo')).toHaveValue('info@fase8.example.invalid');
    await prepared.getByLabel('Asunto', { exact: true }).fill('Asunto editado');
    await prepared.getByLabel('Cuerpo', { exact: true }).fill('Cuerpo editado');
    await expect(prepared.getByLabel('Asunto', { exact: true })).toHaveValue('Asunto editado');
    await page.goto('/mi-dia');
    const limit = new Date(`${madridDate()}T23:59:59.999Z`); limit.setUTCDate(limit.getUTCDate() + 7);
    const total = await db.task.count({ where: { status: 'PENDING', company: { acceptanceStatus: 'ACCEPTED' }, OR: [{ dueAt: { lte: limit } }, { dueAt: null }] } });
    const context = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState() });
    try {
      const plain = await context.newPage();
      await plain.goto(`http://localhost:3100/mi-dia?fecha=${madridDate()}`);
      await plain.getByLabel('Buscar', { exact: true }).fill('bodega avila fase8');
      await plain.getByLabel('Tipo de tarea').selectOption('EMAIL');
      await plain.getByRole('button', { name: 'Ver tareas', exact: true }).click();
      await expect(plain.getByTestId('task-count')).toHaveText(`1 de ${total} tareas`);
      await expect(plain.getByRole('article')).toHaveCount(1);
      await expect(plain.getByLabel('Buscar', { exact: true })).toHaveValue('bodega avila fase8');
      await expect(plain.getByLabel('Tipo de tarea')).toHaveValue('EMAIL');
      await plain.getByRole('link', { name: 'Quitar filtros' }).click();
      await expect(plain.getByTestId('task-count')).toHaveText(`${total} de ${total} tareas`);
    } finally { await context.close(); }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/mi-dia?buscar=bodega+avila+fase8&tipo=EMAIL');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.goto('/mi-dia?tarea=no-existe');
    await expect(page.getByRole('main').getByRole('alert')).toContainText('La tarea solicitada no existe');
  } finally { await db.company.deleteMany({ where: { id: companyId } }); await db.$disconnect(); }
});
