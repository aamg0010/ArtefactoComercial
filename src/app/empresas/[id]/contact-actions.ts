'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ConsentStatus, ContactSource, LegalBasis, Prisma } from '@prisma/client';
import { z } from 'zod';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { normalizeDomain } from '@/lib/normalization';
import { sameContact } from '@/lib/contacts/labels';
import { enqueueCompany, enqueueContact, enqueueContactDelete } from '@/lib/trygestion/outbox';

async function editor() {
  const session = await auth();
  if (!session?.user?.id || session.user.role === 'DIRECTOR') throw new Error('No autorizado');
  return session.user.id;
}
/** Los campos vacíos del formulario llegan como "": se tratan como no informados. */
const optional = (schema: z.ZodString) => z.preprocess(value => typeof value === 'string' && value.trim() === '' ? undefined : typeof value === 'string' ? value.trim() : value, schema.optional());
/** Ids de la base: cuid, o legibles en los datos importados al inicio (p. ej. «contact-la-chipranesca-s-c-l»). */
const recordId = z.string().trim().min(1).max(191).regex(/^[\w-]+$/);
const companyId = recordId;
function done(id: string, result: string): never {
  revalidatePath(`/empresas/${id}`); revalidatePath('/'); revalidatePath('/mi-dia');
  redirect(`/empresas/${id}?${result}#contactos`);
}

export async function addContactAction(form: FormData) {
  const userId = await editor();
  const id = companyId.parse(form.get('companyId'));
  const parsed = z.object({
    fullName: z.string().trim().min(2).max(120), role: optional(z.string().max(100)), email: optional(z.string().email().max(160)), phone: optional(z.string().max(40)),
    legalBasis: z.nativeEnum(LegalBasis), requiresConsent: z.literal('on').optional(),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) done(id, 'error=contacto-invalido');
  const input = parsed.data;
  const existing = await prisma.contact.findMany({ where: { companyId: id } });
  if (existing.some(contact => sameContact(contact, input))) done(id, 'error=contacto-duplicado');
  const requiresConsent = Boolean(input.requiresConsent) || input.legalBasis === 'CONSENT';
  await prisma.$transaction(async tx => {
    const contact = await tx.contact.create({ data: {
      companyId: id, fullName: input.fullName, role: input.role ?? null, email: input.email ?? null, phone: input.phone ?? null,
      legalBasis: input.legalBasis, requiresConsent, consentStatus: requiresConsent ? ConsentStatus.PENDING : ConsentStatus.NOT_REQUIRED,
      source: ContactSource.MANUAL, sourceDetail: 'Alta manual',
    } });
    await tx.auditLog.create({ data: { userId, entityType: 'Contact', entityId: contact.id, action: 'CREATED' } });
    await enqueueContact(tx, contact.id);
  });
  done(id, 'ok=contacto-anadido');
}

export async function deleteContactAction(form: FormData) {
  const userId = await editor();
  const id = companyId.parse(form.get('companyId'));
  const contact = await prisma.contact.findFirst({ where: { id: recordId.parse(form.get('contactId')), companyId: id } });
  if (!contact) done(id, 'error=contacto-no-encontrado');
  await prisma.$transaction(async tx => {
    // Las tareas o emails que lo citen se conservan: solo se borra la persona de contacto.
    await tx.contact.delete({ where: { id: contact.id } });
    await tx.auditLog.create({ data: { userId, entityType: 'Contact', entityId: contact.id, action: 'DELETED', metadata: { companyId: id, trygestionContactoId: contact.trygestionContactoId } } });
    if (contact.trygestionContactoId) await enqueueContactDelete(tx, contact.id, contact.trygestionContactoId);
  });
  done(id, 'ok=contacto-borrado');
}

export async function consentAction(form: FormData) {
  const userId = await editor();
  const id = companyId.parse(form.get('companyId'));
  const status = z.enum(['GRANTED', 'WITHDRAWN', 'PENDING']).parse(form.get('status'));
  const contact = await prisma.contact.findFirst({ where: { id: recordId.parse(form.get('contactId')), companyId: id } });
  if (!contact) done(id, 'error=contacto-no-encontrado');
  await prisma.$transaction(async tx => {
    await tx.contact.update({ where: { id: contact.id }, data: { consentStatus: status, requiresConsent: true } });
    await tx.auditLog.create({ data: { userId, entityType: 'Contact', entityId: contact.id, action: `CONSENT_${status}` } });
  });
  done(id, 'ok=consentimiento');
}

export async function updateCompanyAction(form: FormData) {
  const userId = await editor();
  const id = companyId.parse(form.get('companyId'));
  const parsed = z.object({
    phone: optional(z.string().max(40)), email: optional(z.string().email().max(160)), website: optional(z.string().max(255)), address: optional(z.string().max(255)),
    city: optional(z.string().max(100)), region: optional(z.string().max(100)), sector: optional(z.string().max(100)), nifNit: optional(z.string().max(32)),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) done(id, 'error=empresa-invalida');
  const input = parsed.data;
  const website = input.website ? (input.website.includes('://') ? input.website : `https://${input.website}`) : null;
  try {
    await prisma.$transaction(async tx => {
      await tx.company.update({ where: { id }, data: {
        phone: input.phone ?? null, email: input.email?.toLowerCase() ?? null, website, normalizedDomain: normalizeDomain(website), address: input.address ?? null,
        city: input.city ?? null, region: input.region ?? null, sector: input.sector ?? null, nifNit: input.nifNit ? input.nifNit.toUpperCase() : null,
      } });
      await tx.auditLog.create({ data: { userId, entityType: 'Company', entityId: id, action: 'UPDATED', metadata: { fields: Object.keys(input) } } });
      await enqueueCompany(tx, id);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') done(id, 'error=nif-duplicado');
    throw error;
  }
  done(id, 'ok=empresa-guardada');
}
