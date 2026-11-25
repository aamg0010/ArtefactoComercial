import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { e2eDatabaseUrl, e2eEnvironment } from './environment';
import { madridDate } from '../src/lib/dates';
import { addDays, REMINDER_TITLE } from '../src/lib/guia/engine';
import { reminderId } from '../src/lib/guia/mutations';

test('Guía del día: vencidas, Día 6, siguiente paso y pausa 90 días actualizan la insignia', async ({ page }) => {
  const db = new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl } } });
  const prefix = 'fase10-e2e-'; const today = madridDate();
  const cycleId = `${prefix}cycle`; const cadenceId = `${prefix}cadence`;
  try {
    await db.company.deleteMany({ where: { id: { startsWith: prefix } } });
    await db.cadence.deleteMany({ where: { id: cadenceId } });
    await db.cadence.create({ data: { id: cadenceId, name: '[SIMULADA] Guía Fase10', steps: { create: [
      { id: `${prefix}step6`, dayOffset: 6, type: 'EMAIL', action: 'Email de seguimiento 1' },
      { id: `${prefix}step15`, dayOffset: 15, type: 'EMAIL', action: 'Email de cierre de ciclo' },
    ] } } });
    for (const [id, name, pipelineStage] of [
      ['overdue', 'Vencida', 'DETECTED'], ['today', 'Día seis', 'DETECTED'], ['next', 'Sin paso', 'CONTACTING'], ['closed', 'Ciclo cerrado', 'CONTACTING'],
    ]) await db.company.create({ data: { id: `${prefix}${id}`, name: `[SIMULADA] Fase10 ${name}`, normalizedName: `fase10 ${id}`, country: 'ES', fictional: true, pipelineStage } });
    await db.task.create({ data: { id: `${prefix}overdue-task`, companyId: `${prefix}overdue`, type: 'CALL', title: 'Llamada vencida Fase10', dueAt: new Date(addDays(today, -2)) } });
    await db.task.create({ data: { id: `${prefix}today-task`, companyId: `${prefix}today`, type: 'EMAIL', title: 'Email de seguimiento 1', cadenceStepId: `${prefix}step6`, dueAt: new Date(today) } });
    await db.companyCadence.create({ data: { id: cycleId, companyId: `${prefix}closed`, cadenceId, startDate: new Date(addDays(today, -14)) } });
    await db.task.create({ data: { companyId: `${prefix}closed`, companyCadenceId: cycleId, cadenceStepId: `${prefix}step15`, type: 'EMAIL', title: 'Cierre Fase10', status: 'COMPLETED', completedAt: new Date(), result: 'No contesta' } });
    await page.route(/https?:\/\/([^/]+\.)?(trygestion\.com|trycompany\.es)(\/|$)/, route => route.abort());
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('comercial@try.company');
    await page.getByLabel('Contraseña', { exact: true }).fill(e2eEnvironment.SEED_SALES_PASSWORD);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL('http://localhost:3100/');
    await page.goto(`/empresas/${prefix}overdue`);
    await expect(page.getByRole('region', { name: 'Avisos de seguimiento' })).toContainText('Vencida hace 2 días');
    await page.goto('/mi-dia');
    const guide = page.getByRole('region', { name: 'Guía del día', exact: true });
    await expect(guide).toBeVisible();
    const initial = Number(await page.getByTestId('guide-badge').innerText());
    const importantCount = async () => {
      const counts = await Promise.all(['replies', 'overdue', 'next', 'closed', 'reminders'].map(id => page.getByTestId(`guide-count-${id}`).innerText()));
      return counts.reduce((n, text) => n + Number(text.split(': ').at(-1)), 0);
    };
    expect(initial).toBe(await importantCount());
    await expect(guide.getByTestId('guide-group-today')).toContainText('Día 6 · Email de seguimiento 1');
    await expect(guide.getByTestId('guide-group-next')).toContainText('[SIMULADA] Fase10 Sin paso');
    await expect(guide.getByTestId('guide-group-closed')).toContainText('[SIMULADA] Fase10 Ciclo cerrado');
    await guide.locator(`[data-notice-id="${prefix}overdue-task"]`).getByRole('button', { name: 'Posponer 3 días', exact: true }).click();
    await expect(guide.getByTestId('guide-group-overdue').locator(`[data-notice-id="${prefix}overdue-task"]`)).toHaveCount(0);
    await expect(page.getByTestId('guide-badge')).toHaveText(String(initial - 1));
    expect((await db.task.findUniqueOrThrow({ where: { id: `${prefix}overdue-task` } })).dueAt).toEqual(new Date(addDays(today, 3)));
    const next = guide.getByTestId('guide-group-next').locator(`[data-notice-id="${prefix}next"]`);
    await expect(next.getByLabel('Fecha del siguiente paso')).toHaveValue(addDays(today, 1));
    await next.getByRole('button', { name: 'Crear siguiente paso', exact: true }).click();
    await expect(next).toHaveCount(0);
    await expect(page.getByTestId('guide-badge')).toHaveText(String(initial - 2));
    expect(await db.task.count({ where: { companyId: `${prefix}next`, status: 'PENDING' } })).toBe(1);
    await guide.getByTestId('guide-group-closed').locator(`[data-notice-id="${cycleId}"]`).getByRole('button', { name: 'Pausar 90 días', exact: true }).click();
    await expect(guide.getByTestId('guide-group-closed').locator(`[data-notice-id="${cycleId}"]`)).toHaveCount(0);
    await expect(page.getByTestId('guide-badge')).toHaveText(String(initial - 4));
    expect(await importantCount()).toBe(initial - 4);
    expect((await db.companyCadence.findUniqueOrThrow({ where: { id: cycleId } })).status).toBe('PAUSED');
    expect(await db.task.count({ where: { id: reminderId(cycleId), title: REMINDER_TITLE, dueAt: new Date(addDays(today, 90)) } })).toBe(1);
    await page.goto(`/empresas/${prefix}today`);
    await page.goto('/mi-dia');
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(guide).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await db.company.deleteMany({ where: { id: { startsWith: prefix } } });
    await db.cadence.deleteMany({ where: { id: cadenceId } });
    await db.auditLog.deleteMany({ where: { entityId: { startsWith: prefix } } });
    await db.$disconnect();
  }
});

test('cualquier usuario (también el comercial) ve todo el equipo por defecto y puede quedarse con lo suyo', async ({ page }) => {
  const db = new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl } } });
  const id = 'fase10-admin-company';
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@try.company' } });
    await db.company.create({ data: { id, name: '[SIMULADA] Fase10 de otro comercial', normalizedName: id, fictional: true, country: 'ES', ownerId: admin.id, pipelineStage: 'CONTACTING' } });
    await page.route(/https?:\/\/([^/]+\.)?(trygestion\.com|trycompany\.es)(\/|$)/, route => route.abort());
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('comercial@try.company');
    await page.getByLabel('Contraseña', { exact: true }).fill(e2eEnvironment.SEED_SALES_PASSWORD);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL('http://localhost:3100/');
    await page.goto('/mi-dia');
    const guide = page.getByRole('region', { name: 'Guía del día', exact: true });
    await expect(guide).toContainText('[SIMULADA] Fase10 de otro comercial');
    const team = Number(await page.getByTestId('guide-badge').innerText());
    const counts = await Promise.all(['replies', 'overdue', 'next', 'closed', 'reminders'].map(key => page.getByTestId(`guide-count-${key}`).innerText()));
    expect(team).toBe(counts.reduce((n, text) => n + Number(text.split(': ').at(-1)), 0));
    await page.getByRole('combobox', { name: 'Alcance', exact: true }).selectOption('0');
    await page.getByRole('button', { name: 'Ver guía', exact: true }).click();
    await expect(guide).not.toContainText('[SIMULADA] Fase10 de otro comercial');
    await expect.poll(async () => Number(await page.getByTestId('guide-badge').innerText())).toBeLessThan(team);
  } finally { await db.company.deleteMany({ where: { id } }); await db.$disconnect(); }
});
