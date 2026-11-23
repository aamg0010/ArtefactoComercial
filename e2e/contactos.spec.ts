import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { e2eDatabaseUrl, e2eEnvironment } from './environment';

test('en la ficha se añade un contacto, no se duplica y se puede borrar', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('comercial@try.company');
  await page.getByLabel('Contraseña', { exact: true }).fill(e2eEnvironment.SEED_SALES_PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:3100/');
  await page.getByRole('link', { name: 'Limabril S.L.', exact: true }).first().click();
  const data = page.getByRole('region', { name: 'Datos de empresa', exact: true });
  await expect(data).not.toContainText('ChIJ');

  const add = async () => {
    if (!await data.getByRole('button', { name: 'Añadir contacto', exact: true }).isVisible()) await data.getByText('➕ Añadir persona de contacto').click();
    await data.getByLabel('Nombre', { exact: true }).fill('Compras E2E');
    await data.getByLabel('Cargo', { exact: true }).fill('Responsable de compras');
    await data.getByLabel('Email', { exact: true }).fill('compras-e2e@limabril.example.invalid');
    await data.getByRole('combobox').selectOption('LEGITIMATE_INTEREST');
    await data.getByRole('button', { name: 'Añadir contacto', exact: true }).click();
  };
  await add();
  await expect(page.getByRole('main').getByRole('status')).toContainText('Contacto añadido.');
  const contacts = page.getByRole('region', { name: 'Personas de contacto' });
  await expect(contacts.getByRole('listitem').filter({ hasText: 'Compras E2E' })).toHaveCount(1);
  await expect(contacts).toContainText('Base legal: Interés legítimo');

  await add();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Ese contacto ya existe');
  await expect(contacts.getByRole('listitem').filter({ hasText: 'Compras E2E' })).toHaveCount(1);

  const card = contacts.getByRole('listitem').filter({ hasText: 'Compras E2E' });
  await card.getByText('Borrar', { exact: true }).click();
  await card.getByRole('button', { name: 'Sí, borrar Compras E2E' }).click();
  await expect(page.getByRole('main').getByRole('status')).toContainText('Contacto borrado');
  await expect(contacts.getByRole('listitem').filter({ hasText: 'Compras E2E' })).toHaveCount(0);
});

test('se borra un contacto de los datos iniciales, cuyo id no es cuid', async ({ page }) => {
  const db = new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl } } });
  let companyId: string;
  try {
    await db.contact.deleteMany({ where: { id: 'contact-e2e-id-legible' } });
    await db.company.deleteMany({ where: { normalizedName: 'empresa ids legibles e2e' } });
    const company = await db.company.create({ data: {
      name: '[SIMULADA] Empresa ids legibles E2E', normalizedName: 'empresa ids legibles e2e', country: 'ES', fictional: true, acceptanceStatus: 'ACCEPTED',
      contacts: { create: { id: 'contact-e2e-id-legible', fullName: 'Contacto inicial E2E', phone: '978000000', legalBasis: 'LEGITIMATE_INTEREST', consentStatus: 'NOT_REQUIRED' } },
    } }); companyId = company.id;
  } finally { await db.$disconnect(); }
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('comercial@try.company');
  await page.getByLabel('Contraseña', { exact: true }).fill(e2eEnvironment.SEED_SALES_PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:3100/');
  await page.goto(`/empresas/${companyId}`);
  const card = page.getByRole('region', { name: 'Personas de contacto' }).getByRole('listitem').filter({ hasText: 'Contacto inicial E2E' });
  await card.getByText('Borrar', { exact: true }).click();
  await card.getByRole('button', { name: 'Sí, borrar Contacto inicial E2E' }).click();
  await expect(page.getByRole('main').getByRole('status')).toContainText('Contacto borrado');
  await expect(card).toHaveCount(0);
});
