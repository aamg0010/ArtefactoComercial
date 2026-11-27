import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { e2eDatabaseUrl, e2eEnvironment } from './environment';
import { mockResearch } from '../src/lib/research/schema';
import { mockScript } from '../src/lib/research/scripts';
import templates from '../data/guiones.json';

test('regenera un aprobado con borrador antiguo y actualiza el email pendiente; investiga en segundo plano', async ({ page }) => {
  test.setTimeout(90000);
  const db = new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl } } });
  const companyId = 'fase15-background';
  const user = await db.user.findUniqueOrThrow({ where: { email: 'comercial@try.company' } });
  const research = mockResearch([{ id: 'crm', url: `urn:try-comercial:company:${companyId}`, date: new Date().toISOString(), text: 'Empresa simulada dedicada a elaborar vino de garnacha y registrar sus lotes.' }], 'vino de garnacha', ['Athenea'], 'Sin web');
  const companyName = 'Bodegas de ensayo [SIMULADA]';
  const old = mockScript(companyName, 'Athenea', research, templates.cadencia_estandar);
  old.emails.forEach(email => { email.cuerpo = email.cuerpo.replace('[NOMBRE]', 'equipo'); });
  try {
    await db.company.create({ data: { id: companyId, name: companyName, normalizedName: 'fase15 background', fictional: true, sector: 'vino de garnacha', ownerId: user.id, country: 'ES', researchReports: { create: { id: 'fase15-research', origin: 'AI', data: JSON.parse(JSON.stringify(research)) } }, scripts: { create: [
      { id: 'fase15-old', version: 1, status: 'BORRADOR', author: 'IA', content: JSON.parse(JSON.stringify(old)) },
      { id: 'fase15-approved', version: 2, status: 'APPROVED', author: 'IA', content: JSON.parse(JSON.stringify(old)) },
    ] } } });
    await db.task.create({ data: { id: 'fase15-email', companyId, scriptId: 'fase15-approved', scriptEmailIndex: 0, assigneeId: user.id, type: 'EMAIL', title: 'Email fase15', dueAt: new Date() } });
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(user.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(e2eEnvironment.SEED_SALES_PASSWORD);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL('http://localhost:3100/');
    await page.goto(`/empresas/${companyId}`);
    await page.getByRole('button', { name: 'Regenerar guion', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Generando guion con IA' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Regenerar guion', exact: true })).toBeDisabled();
    await expect(page.getByText('Guion nuevo listo: revísalo y apruébalo.', { exact: true })).toBeVisible({ timeout: 20000 });
    const draft = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Guion versión 3 · IA · BORRADOR', exact: true }) });
    await expect(draft).toContainText('Buenos días, [NOMBRE]:');
    await expect(page.getByRole('button', { name: 'Ya hay un borrador nuevo para revisar', exact: true })).toBeDisabled();
    await draft.getByRole('checkbox', { name: /He revisado este borrador/ }).check();
    await draft.getByRole('button', { name: 'Actualizar textos de los emails pendientes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Guion versión 3 · IA · Aprobado', exact: true })).toBeVisible();
    const task = await db.task.findUniqueOrThrow({ where: { id: 'fase15-email' }, include: { script: true } });
    expect(task.script?.version).toBe(3);
    await page.goto('/mi-dia?tarea=fase15-email');
    await expect(page.getByRole('region', { name: 'Email preparado', exact: true }).getByLabel('Cuerpo', { exact: true })).toHaveValue(/^Buenos días:/);
    await page.goto(`/empresas/${companyId}`);
    await page.getByRole('button', { name: 'Investigar', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Investigando…' })).toBeVisible();
    await expect(page.getByText('Investigación lista.', { exact: true })).toBeVisible({ timeout: 20000 });
    expect(await db.auditLog.count({ where: { entityId: companyId, action: { in: ['SCRIPT_GENERATED', 'RESEARCH_DONE'] } } })).toBe(2);
  } finally {
    await db.company.deleteMany({ where: { id: companyId } });
    await db.auditLog.deleteMany({ where: { entityId: companyId } });
    await db.$disconnect();
  }
});
