import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { e2eDatabaseUrl, e2eEnvironment } from './environment';
import { mockResearch } from '../src/lib/research/schema';

test('guion profesional simulado, saludo de contacto y firma por defecto editable', async ({ page }) => {
  const db = new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl } } });
  const companyId = 'fase14-borsao';
  const user = await db.user.findUniqueOrThrow({ where: { email: 'comercial@try.company' } });
  try {
    await db.user.update({ where: { id: user.id }, data: { signatureName: null, signatureTitle: null } });
    const research = mockResearch([{ id: 'web-1', url: 'https://borsao.example.invalid', date: '2026-11-26T09:00:00.000Z', text: 'Bodegas Borsao elabora vino de garnacha en la DOP Campo de Borja y registra lotes de vendimia y embotellado.' }], 'vino de garnacha', ['Athenea'], 'Datos simulados sin rastreo');
    await db.company.create({ data: { id: companyId, name: 'Bodegas Borsao simulada', normalizedName: 'fase14 borsao', fictional: true, country: 'ES', sector: 'vino de garnacha', ownerId: user.id, contacts: { create: { id: 'fase14-contact', fullName: 'Marta López', email: 'marta@borsao.example.invalid', legalBasis: 'LEGITIMATE_INTEREST' } }, researchReports: { create: { id: 'fase14-research', origin: 'AI', data: JSON.parse(JSON.stringify(research)) } } } });
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(user.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(e2eEnvironment.SEED_SALES_PASSWORD);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL('http://localhost:3100/');
    await page.goto(`/empresas/${companyId}`);
    await page.getByRole('button', { name: 'Generar guion', exact: true }).click();
    await expect(page.getByText('Guion versión 1 · IA · BORRADOR', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Aprobar guion', exact: true }).click();
    await expect(page.getByText('Guion versión 1 · IA · Aprobado', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Enviar desde Mi día', exact: true }).first().click();
    const email = page.getByRole('region', { name: 'Email preparado', exact: true });
    await expect(email.getByLabel('Cuerpo', { exact: true })).toHaveValue(/^Buenos días, Marta:/);
    await expect(email.getByLabel('Cuerpo', { exact: true })).not.toHaveValue(/Soy el equipo/i);
    await expect(email.getByLabel('Nombre', { exact: true })).toHaveValue('Andrés Martínez');
    await expect(email.getByLabel('Cargo', { exact: true })).toHaveValue('Gerente');
    await email.getByLabel('Nombre', { exact: true }).fill('Ana Comercial');
    await expect(email.getByLabel('Nombre', { exact: true })).toHaveValue('Ana Comercial');
    await email.getByLabel('Destinatario corporativo', { exact: true }).fill('info@borsao.example.invalid');
    await expect(email.getByLabel('Cuerpo', { exact: true })).toHaveValue(/^Buenos días:\n/);
  } finally {
    const cadence = await db.companyCadence.findMany({ where: { companyId }, select: { cadenceId: true } });
    await db.company.deleteMany({ where: { id: companyId } });
    await db.cadence.deleteMany({ where: { id: { in: cadence.map(c => c.cadenceId) } } });
    await db.user.update({ where: { id: user.id }, data: { signatureName: user.signatureName, signatureTitle: user.signatureTitle } });
    await db.$disconnect();
  }
});
