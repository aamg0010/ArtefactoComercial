import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { e2eDatabaseUrl, e2eEnvironment } from './environment';
import { madridDate } from '../src/lib/dates';
import { addDays } from '../src/lib/guia/engine';

test('semáforo: filtro inicial, chips, fechas y confirmación antes de adelantar un email', async ({ page }) => {
  const db = new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl } } });
  const prefix = 'fase11-e2e-';
  const day = madridDate(); const next = addDays(day, 6);
  try {
    await db.company.deleteMany({ where: { id: { startsWith: prefix } } });
    for (const color of ['green', 'amber', 'red', 'gray']) await db.company.create({ data: {
      id: `${prefix}${color}`, name: `[SIMULADA] Fase11 ${color}`, normalizedName: `${prefix}${color}`, country: 'ES', fictional: true,
      detectedAt: new Date(),
      ...(color === 'red' ? { activities: { create: { type: 'CALL', createdAt: new Date(`${addDays(day, -3)}T12:00:00Z`) } },
        scripts: { create: { id: `${prefix}script`, author: 'E2E', content: { emails: [{ dia: 6, asunto: 'Seguimiento Fase11', cuerpo: 'Prueba sin envío' }] } } },
        tasks: { create: { type: 'EMAIL', title: 'Seguimiento Fase11', dueAt: new Date(next) } } } : {}),
      ...(color === 'amber' ? { tasks: { create: { type: 'CALL', title: 'Llamar hoy Fase11', dueAt: new Date(day) } } } : {}),
      ...(color === 'gray' ? { suppressions: { create: { reason: 'Baja ficticia Fase11' } }, tasks: { create: { type: 'CALL', title: 'No llamar Fase11 gris', dueAt: new Date(day) } } } : {}),
    } });
    await page.route(/https?:\/\/([^/]+\.)?(trygestion\.com|trycompany\.es)(\/|$)/, route => route.abort());
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('comercial@try.company');
    await page.getByLabel('Contraseña', { exact: true }).fill(e2eEnvironment.SEED_SALES_PASSWORD);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL('http://localhost:3100/');
    await page.goto('/?q=Fase11');
    const table = page.getByRole('table');
    await expect(table).toContainText('[SIMULADA] Fase11 green');
    await expect(table).toContainText('[SIMULADA] Fase11 amber');
    await expect(table).not.toContainText('[SIMULADA] Fase11 red');
    await expect(table).not.toContainText('[SIMULADA] Fase11 gray');
    for (const color of ['green', 'amber', 'red', 'gray']) await expect(page.getByTestId(`contact-chip-${color}`)).toContainText('(1)');
    await page.getByTestId('contact-chip-red').click();
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table).toContainText('[SIMULADA] Fase11 red');
    await page.getByLabel('Mostrar', { exact: true }).selectOption('all');
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(table.getByRole('row')).toHaveCount(5);
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole('main').locator('ul').filter({ hasText: '[SIMULADA] Fase11 red' })).toContainText('Contactada · espera');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/empresas/${prefix}red`);
    const banner = page.getByRole('region', { name: 'Estado de contacto', exact: true });
    await expect(banner).toContainText(`Contactada el ${addDays(day, -3).slice(8)}/${addDays(day, -3).slice(5, 7)}`);
    await expect(banner).toContainText(`Próximo contacto el ${next.slice(8)}/${next.slice(5, 7)}`);
    const prepare = page.getByRole('button', { name: 'Enviar desde Mi día', exact: true });
    const form = page.locator('form').filter({ has: prepare });
    await prepare.click();
    await expect(page).toHaveURL(new RegExp(`/empresas/${prefix}red$`));
    await expect(form.getByRole('alert')).toContainText('Contactada el');
    await expect(form.getByLabel('Sí, quiero contactarla igualmente')).not.toBeChecked();
    await form.getByLabel('Sí, quiero contactarla igualmente').check();
    await prepare.click();
    await expect(page).toHaveURL(/\/mi-dia\?tarea=/);
    await expect(page.getByRole('article').filter({ hasText: '[SIMULADA] Fase11 gray' })).toHaveCount(0);
    expect(await db.auditLog.count({ where: { entityId: `${prefix}red`, action: 'CONTACT_WAIT_OVERRIDE' } })).toBe(1);
    await page.goto('/rastreo');
    const ready = page.getByRole('region', { name: 'Listas para trabajar', exact: true });
    await expect(ready).not.toContainText('[SIMULADA] Fase11 gray');
    await ready.getByRole('link', { name: /Ver también las contactadas/ }).click();
    await expect(ready).toContainText('[SIMULADA] Fase11 gray');
    await page.goto('/pipeline');
    await expect(page.locator('article').filter({ hasText: '[SIMULADA] Fase11 green' }).locator('[data-contact-color="green"]')).toBeVisible();
  } finally {
    await db.company.deleteMany({ where: { id: { startsWith: prefix } } });
    await db.auditLog.deleteMany({ where: { entityId: { startsWith: prefix } } });
    await db.$disconnect();
  }
});
