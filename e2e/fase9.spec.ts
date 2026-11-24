import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { e2eDatabaseUrl, e2eEnvironment } from './environment';
import { tomorrowMadrid } from '../src/lib/email-replies';

test('gestionar una respuesta desde Pipeline crea el seguimiento para mañana en Mi día', async ({ page }) => {
  const db = new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl } } });
  const companyId = 'fase9-e2e-empresa';
  let replyId: string | undefined;
  try {
    await db.company.deleteMany({ where: { id: companyId } });
    await db.company.create({ data: { id: companyId, name: '[SIMULADA] Respuestas Fase9', normalizedName: 'simulada respuestas fase9', country: 'ES', fictional: true, email: 'info@fase9.invalid' } });
    const reply = await db.emailReply.create({ data: { companyId, trygestionId: randomUUID(), fromEmail: 'info@fase9.invalid', subject: 'Re: Propuesta Fase9', receivedAt: new Date(), summary: 'Quiere que llamemos mañana.', excerpt: 'Gracias por la propuesta.', priority: 'alta', category: 'interesado', method: 'hilo' } });
    replyId = reply.id;
    await page.route(/https?:\/\/([^/]+\.)?(trygestion\.com|trycompany\.es)(\/|$)/, route => route.abort());
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('comercial@try.company');
    await page.getByLabel('Contraseña', { exact: true }).fill(e2eEnvironment.SEED_SALES_PASSWORD);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL('http://localhost:3100/');
    await page.goto('/mi-dia'); await expect(page.getByRole('link', { name: 'Ver en el Pipeline' })).toBeVisible();
    await page.goto(`/empresas/${companyId}`); await expect(page.getByRole('region', { name: 'Respuestas recibidas' })).toContainText(reply.subject);
    await page.goto('/pipeline');
    const card = page.locator(`[data-reply-id="${reply.id}"]`);
    await expect(card).toContainText(reply.subject); await expect(card).toContainText(reply.summary!);
    await expect(page.getByRole('region', { name: 'Detectada', exact: true }).getByRole('article').filter({ hasText: '[SIMULADA] Respuestas Fase9' })).toContainText('Respondió');
    await expect(card.getByLabel('Fecha del seguimiento')).toHaveValue(tomorrowMadrid());
    await card.getByLabel('Tipo de seguimiento').selectOption('CALL'); await card.getByLabel('Nota opcional').fill('Llamar por la tarde Fase9');
    await card.getByRole('button', { name: 'Crear seguimiento', exact: true }).click();
    await expect(card).toHaveCount(0);
    await page.getByRole('link', { name: 'Ver respuestas gestionadas' }).click();
    await expect(page.getByRole('region', { name: 'Respuestas gestionadas', exact: true })).toContainText(reply.subject);
    await page.goto('/mi-dia?mostrar=upcoming&buscar=Respuestas+Fase9');
    await expect(page.getByRole('region', { name: /^Próximos 7 días/ })).toContainText('Seguimiento: Re: Propuesta Fase9');
    await expect(page.getByRole('region', { name: /^Próximos 7 días/ })).toContainText('Llamar por la tarde Fase9');
    expect(await db.task.count({ where: { companyId } })).toBe(1);
  } finally {
    if (replyId) await db.emailReply.deleteMany({ where: { id: replyId } });
    await db.company.deleteMany({ where: { id: companyId } }); await db.$disconnect();
  }
});
