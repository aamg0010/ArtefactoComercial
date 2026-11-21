import { expect, test } from '@playwright/test';
import { e2eEnvironment } from './environment';

test('login, guion de Mi día, reunión de Caspe, kanban y protección de sesión', async ({ page, browser }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('comercial@try.company');
  await page.getByLabel('Contraseña', { exact: true }).fill(e2eEnvironment.SEED_SALES_PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:3100/');

  await page.goto('/mi-dia?fecha=2026-11-23');
  const today = page.getByRole('region', { name: 'Hoy', exact: true });
  const calandina = today.getByRole('article').filter({ has: page.getByRole('heading', { name: /La Calandina S\. Coop\./ }) });
  const caspe = today.getByRole('article').filter({ has: page.getByRole('heading', { name: /Cooperativa Ganadera de Caspe/ }) });
  await expect(calandina.first()).toBeVisible();
  await expect(caspe.first()).toBeVisible();
  await calandina.first().getByText('Guion y emails', { exact: true }).click();
  await expect(calandina.first().getByText('Pregunta clave:', { exact: true })).toBeVisible();
  await expect(calandina.first().getByText('Objeciones', { exact: true })).toBeVisible();

  await caspe.first().getByRole('button', { name: 'Reunión agendada', exact: true }).click();
  await expect(caspe).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mi día', exact: true })).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'Cooperativa Ganadera de Caspe' })).toHaveCount(0);

  await page.goto('/pipeline');
  const meeting = page.getByRole('region', { name: 'Reunión', exact: true });
  await expect(meeting.getByRole('article').filter({ hasText: 'Cooperativa Ganadera de Caspe' })).toBeVisible();
  await expect(meeting.getByRole('article').filter({ hasText: 'La Calandina S. Coop.' })).toHaveCount(0);

  const anonymous = await browser.newContext();
  try {
    const anonymousPage = await anonymous.newPage();
    await anonymousPage.goto('http://localhost:3100/mi-dia');
    await expect(anonymousPage).toHaveURL(/\/login(?:\?|$)/);
    await expect(anonymousPage.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  } finally {
    await anonymous.close();
  }
});
