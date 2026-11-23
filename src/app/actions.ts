'use server';
import { revalidatePath } from 'next/cache';
import { ContactSource, Country, LegalBasis, ConsentStatus } from '@prisma/client';
import { auth } from '@/auth';
import { parseCompanyCsv } from '@/lib/csv';
import { normalizeDomain, normalizeText } from '@/lib/normalization';
import { prisma } from '@/lib/prisma';
import { enqueueCompany, enqueueContact } from '@/lib/trygestion/outbox';
import { z } from 'zod';

async function actor() { const session = await auth(); if (!session?.user?.id) throw new Error('No autenticado'); return session.user.id; }
/** Los campos vacíos del formulario llegan como "": se tratan como no informados. */
const optional = (schema: z.ZodString) => z.preprocess(value => typeof value === 'string' && value.trim() === '' ? undefined : typeof value === 'string' ? value.trim() : value, schema.optional());
const companyInput = z.object({ name: z.string().trim().min(2).max(160), country: z.nativeEnum(Country), region: optional(z.string().max(100)), city: optional(z.string().max(100)), sector: optional(z.string().max(100)), website: optional(z.string().max(255)), email: optional(z.string().email()), phone: optional(z.string().max(40)), nifNit: optional(z.string().max(32)) });
export async function createCompany(formData: FormData) {
  const userId = await actor(); const input = companyInput.parse(Object.fromEntries(formData));
  const normalizedName = normalizeText(input.name); const normalizedDomain = normalizeDomain(input.website);
  await prisma.$transaction(async tx => {
    const duplicate = await tx.company.findFirst({ where: { OR: [{ normalizedName, country: input.country }, ...(input.nifNit ? [{ nifNit: input.nifNit }] : []), ...(normalizedDomain ? [{ normalizedDomain }] : [])] } });
    if (duplicate) throw new Error(`Duplicado detectado: ${duplicate.name}`);
    const company = await tx.company.create({ data: { ...input, website: input.website || null, email: input.email || null, phone: input.phone || null, nifNit: input.nifNit || null, region: input.region || null, city: input.city || null, sector: input.sector || null, normalizedName, normalizedDomain, source: ContactSource.MANUAL, sourceDetail: 'Alta manual', ownerId: userId } });
    await tx.auditLog.create({ data: { userId, entityType: 'Company', entityId: company.id, action: 'CREATED' } }); await enqueueCompany(tx, company.id);
  }); revalidatePath('/');
}
export async function importCompanies(formData: FormData) {
  const userId = await actor(); const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) throw new Error('Selecciona un CSV.'); if (file.size > 1024 * 1024) throw new Error('El CSV no puede superar 1 MB.');
  const records = parseCompanyCsv(await file.text()); let created = 0; let duplicates = 0;
  for (const row of records) {
    const added = await prisma.$transaction(async tx => {
      const existing = await tx.company.findFirst({ where: { OR: [{ normalizedName: row.normalizedName, country: row.pais as Country }, ...(row.nifNit ? [{ nifNit: row.nifNit }] : []), ...(row.normalizedDomain ? [{ normalizedDomain: row.normalizedDomain }] : [])] } }); if (existing) return false;
      const company = await tx.company.create({ data: { name: row.nombre, normalizedName: row.normalizedName, normalizedDomain: row.normalizedDomain, country: row.pais as Country, nifNit: row.nifNit || null, website: row.web || null, email: row.email || null, phone: row.telefono || null, region: row.region || null, city: row.ciudad || null, sector: row.sector || null, source: ContactSource.CSV, sourceDetail: 'Importación CSV', ownerId: userId } });
      if (row.contacto) { const contact = await tx.contact.create({ data: { companyId: company.id, fullName: row.contacto, role: row.cargo || null, email: row.emailContacto || null, source: ContactSource.CSV, sourceDetail: 'Importación CSV', legalBasis: LegalBasis.PENDING, consentStatus: ConsentStatus.PENDING, requiresConsent: Boolean(row.emailContacto) } }); await enqueueContact(tx, contact.id); }
      await enqueueCompany(tx, company.id); return true;
    }); if (added) created++; else duplicates++;
  }
  await prisma.auditLog.create({ data: { userId, entityType: 'Company', entityId: 'csv-import', action: 'IMPORTED', metadata: { created, duplicates } } }); revalidatePath('/'); return { created, duplicates };
}
