import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { e2eDatabaseUrl, e2eEnvironment } from './environment';
import { madridDate } from '../src/lib/dates';

test('eliminar empresa exige confirmación y borra sus contactos y tareas', async ({ page }) => {
  const db = new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl } } });
  const companyId = 'fase13-e2e-empresa';
  const name = '[SIMULADA] Borrado Fase13';
  try {
    const sales = await db.user.findUniqueOrThrow({ where: { email: 'comercial@try.company' } });
    await db.company.create({ data: { id: companyId, name, normalizedName: companyId, fictional: true, country: 'ES', ownerId: sales.id,
      contacts: { create: { fullName: 'Contacto ficticio Fase13' } },
      tasks: { create: { type: 'CALL', title: 'Llamar Fase13', assigneeId: sales.id, dueAt: new Date(madridDate()) } },
    } });
    await page.route(/https?:\/\/([^/]+\.)?(trygestion\.com|trycompany\.es)(\/|$)/, route => route.abort());
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(sales.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(e2eEnvironment.SEED_SALES_PASSWORD);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL('http://localhost:3100/');
    await page.goto('/mi-dia');
    await expect(page.getByRole('heading').filter({ hasText: name })).toBeVisible();
    await page.goto(`/?q=${encodeURIComponent(name)}`);
    const row = page.getByRole('row').filter({ hasText: name });
    await row.getByRole('link', { name: 'Eliminar', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/empresas/${companyId}#eliminar$`));
    const danger = page.getByRole('region', { name: 'Zona de peligro' });
    await danger.getByText('Eliminar empresa', { exact: true }).click();
    await danger.getByRole('button', { name: 'Eliminar definitivamente' }).click();
    expect(await db.company.count({ where: { id: companyId } })).toBe(1);
    await expect(page).toHaveURL(new RegExp(`/empresas/${companyId}#eliminar$`));
    await danger.getByRole('checkbox').check();
    await danger.getByRole('button', { name: 'Eliminar definitivamente' }).click();
    await expect(page.getByRole('status').filter({ hasText: `Empresa ${name} eliminada` })).toHaveText(`Empresa ${name} eliminada`);
    await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);
    await page.goto('/mi-dia');
    await expect(page.getByRole('heading').filter({ hasText: name })).toHaveCount(0);
    expect(await db.contact.count({ where: { companyId } })).toBe(0);
    expect(await db.task.count({ where: { companyId } })).toBe(0);
    const response = await page.goto(`/empresas/${companyId}`);
    expect(response?.status()).toBe(404);
  } finally {
    await db.company.deleteMany({ where: { id: companyId } });
    await db.auditLog.deleteMany({ where: { entityId: companyId } });
    await db.$disconnect();
  }
});
