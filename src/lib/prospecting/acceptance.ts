import { withinBudget } from '../research/budget';
import { enqueueCompany, enqueueContact, enqueuePipeline } from '../trygestion/outbox';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Prisma, type PrismaClient } from '@prisma/client';
import { GooglePlacesAdapter } from '../sources/google-places';
import { crawlCompanyWebsite } from '../research/crawler';
import { corporateEmail, businessPhone } from '../company-contact';
import { normalizeDomain, normalizeText } from '../normalization';
import { duplicateReason, normalizedPhone } from './deduplication';
import type { CandidateCompany } from '../sources/types';
import { isSuppressed } from '../suppression';
import { candidateSuppressed } from './service';

const httpUrl = z.string().url().refine(value => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; } });
const citation = z.object({ value: z.string().max(500), url: httpUrl, date: z.string().datetime() });
export const proposalSchema = z.object({ companyId: z.string(), expires: z.number(), purpose: z.literal('complete-web').optional(), baseline: z.object({ website: z.string().nullable(), phone: z.string().nullable(), email: z.string().nullable() }).optional(), fields: z.object({ name: citation.optional(), city: citation.optional(), website: citation.optional(), phone: citation.optional(), email: citation.optional() }) });
export type AcceptanceProposal = z.infer<typeof proposalSchema>;
export const acceptanceInput = z.object({
  name: z.string().trim().min(2).max(250), city: z.string().trim().min(1).max(160),
  website: z.union([httpUrl, z.literal('')]).default(''),
  phone: z.string().trim().max(50).refine(value => !value || Boolean(businessPhone(value))),
  email: z.string().trim().max(250).refine(value => !value || Boolean(corporateEmail(value))),
  confirmed: z.literal(true),
});

export function signProposal(proposal: AcceptanceProposal, secret = process.env.AUTH_SECRET) {
  if (!secret) throw new Error('AUTH_SECRET_REQUIRED');
  const body = Buffer.from(JSON.stringify(proposal)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
export function verifyProposal(token: string, companyId: string, secret = process.env.AUTH_SECRET): AcceptanceProposal | undefined {
  if (!token || token.length > 16000 || !secret) return undefined;
  try {
    const parts = token.split('.'); if (parts.length !== 2) return undefined;
    const [body, signature] = parts; const expected = createHmac('sha256', secret).update(body).digest(); const provided = Buffer.from(signature, 'base64url');
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return undefined;
    const proposal = proposalSchema.parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
    return proposal.companyId === companyId && proposal.expires > Date.now() ? proposal : undefined;
  } catch { return undefined; }
}

export const safeCompanyId = z.string().min(1).max(191).regex(/^[\w-]+$/);
export type ProposalDependencies = {
  details?: (id: string, country: 'ES' | 'CO', signal?: AbortSignal) => Promise<CandidateCompany | null>;
  crawl?: typeof crawlCompanyWebsite;
};

/** Google contributes only a transient website locator, never proposed business values. */
export async function prepareWebsiteProposal(db: PrismaClient, companyId: string, mode: 'accept' | 'complete-web', dependencies: ProposalDependencies = {}) {
  safeCompanyId.parse(companyId);
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId }, include: { sourceIdentities: true } });
  if (company.acceptanceStatus !== (mode === 'accept' ? 'PENDING' : 'ACCEPTED')) throw new Error('COMPANY_STATUS');
  const ref = company.sourceIdentities.find(item => item.source === 'google-places');
  const proposal: AcceptanceProposal = { companyId, expires: Date.now() + 15 * 60_000, fields: {},
    ...(mode === 'complete-web' ? { purpose: 'complete-web' as const, baseline: { website: company.website, phone: company.phone, email: company.email } } : {}) };
  let live: CandidateCompany | null = null;
  const deadline = Date.now() + 38_000;
  // A registered website takes priority; Google is only necessary when it is absent.
  if (ref && !company.website) try {
    const offlineDetails: ProposalDependencies['details'] = async () => company.fictional && ref.sourceRef === 'google-e2e-complete-web' ? {
      name: '[SIMULADA] Google', city: 'Google city', province: '', country: company.country, address: 'Google address', website: 'https://completar.example.invalid', corporatePhone: '978999999', category: '', source: 'google-places', sourceRef: ref.sourceRef, sourceUrl: null, simulated: true,
    } : null;
    live = await withinBudget(signal => (dependencies.details ?? (process.env.E2E_WEBSITE_MOCK === '1' ? offlineDetails : async (id, country, abort) => process.env.GOOGLE_PLACES_API_KEY?.trim() ? new GooglePlacesAdapter(process.env.GOOGLE_PLACES_API_KEY).details(id, country, abort) : null))(ref.sourceRef, company.country, signal), 8_000);
  } catch { /* Independent manual confirmation remains possible. */ }
  let note = 'Sin web consultable. Introduce \u00fanicamente informaci\u00f3n propia confirmada manualmente.';
  const locator = company.website || live?.website;
  if (locator) try {
    const website = await withinBudget(signal => (dependencies.crawl ?? crawlCompanyWebsite)(locator, undefined, { signal, budgetMs: Math.min(30_000, deadline - Date.now()) }), deadline - Date.now());
    note = website.note;
    for (const page of website.business ?? []) for (const field of ['name', 'city', 'phone', 'email'] as const) {
      const value = page[field]; if (value && !proposal.fields[field]) proposal.fields[field] = { value, url: page.url, date: page.date };
    }
    if (website.sources[0]) proposal.fields.website = { value: website.sources[0].url, url: website.sources[0].url, date: website.sources[0].date };
  } catch { note = 'Se agot\u00f3 el tiempo de consulta. Puedes introducir datos propios manualmente o volver a intentarlo.'; }
  return { live, proposal, note };
}

export function prepareAcceptance(db: PrismaClient, companyId: string, dependencies: ProposalDependencies = {}) {
  return prepareWebsiteProposal(db, companyId, 'accept', dependencies);
}

export async function acceptCompany(db: PrismaClient, companyId: string, raw: unknown, userId: string, proposal?: AcceptanceProposal) {
  const input = acceptanceInput.parse(raw);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(48104)`;
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, include: { sourceIdentities: true, opportunities: true } });
    if (company.acceptanceStatus === 'ACCEPTED') return company.id;
    if (company.acceptanceStatus !== 'PENDING' || !company.sourceIdentities.some(item => item.source === 'google-places')) throw new Error('COMPANY_NOT_PENDING');
    if (await isSuppressed(tx, companyId)) throw new Error('COMPANY_SUPPRESSED');
    const phone = businessPhone(input.phone); const email = corporateEmail(input.email);
    if (await candidateSuppressed(tx, { name: input.name, city: input.city, country: company.country, province: company.region ?? '', address: null, website: input.website || null, corporatePhone: phone, category: '', source: 'csv', sourceRef: `manual:${companyId}`, sourceUrl: null, simulated: false })) throw new Error('COMPANY_SUPPRESSED');
    const values = { name: input.name, city: input.city, website: input.website, phone: phone ?? '', email: email ?? '' };
    const provenance: Record<string, { kind: string; url?: string; date: string }> = {};
    for (const [key, value] of Object.entries(values)) {
      if (!value) continue;
      const field = key as keyof typeof values; const claim = proposal?.companyId === companyId && proposal.expires > Date.now() ? proposal.fields[field] : undefined;
      const matches = claim && (field === 'phone' ? normalizedPhone(value, company.country) === normalizedPhone(claim.value, company.country) : field === 'website' ? new URL(value).href === new URL(claim.value).href : field === 'email' ? value.toLowerCase() === claim.value.toLowerCase() : normalizeText(value) === normalizeText(claim.value));
      provenance[key] = matches ? { kind: 'web propia', url: claim.url, date: claim.date } : { kind: 'confirmado manualmente', date: new Date().toISOString() };
    }
    const ownWeb = Object.values(provenance).some(item => item.kind === 'web propia');
    const data = { ...values, website: input.website || null, phone, email, normalizedName: normalizeText(input.name), normalizedDomain: normalizeDomain(input.website), acceptanceStatus: 'ACCEPTED' as const, researchQueuedAt: new Date(), source: ownWeb ? 'WEB' as const : 'MANUAL' as const, sourceDetail: ownWeb ? 'web propia; campos editados confirmados manualmente (ver evidencias)' : 'confirmado manualmente' };
    const rows = await tx.company.findMany({ where: { id: { not: companyId }, acceptanceStatus: 'ACCEPTED' } });
    const duplicate = rows.find(row => duplicateReason({ ...data, country: company.country }, row));
    const targetId = duplicate?.id ?? companyId;
    if (duplicate) {
      await tx.companySource.updateMany({ where: { companyId }, data: { companyId: targetId } });
      for (const opportunity of company.opportunities) await tx.opportunity.upsert({ where: { companyId_productId: { companyId: targetId, productId: opportunity.productId } }, update: {}, create: { companyId: targetId, productId: opportunity.productId } });
      await tx.company.delete({ where: { id: companyId } });
    } else {
      await tx.company.update({ where: { id: companyId }, data });
      const contactOwnWeb = provenance.phone?.kind === 'web propia' || provenance.email?.kind === 'web propia';
      const contactData = { email, phone, source: contactOwnWeb ? 'WEB' as const : 'MANUAL' as const, sourceDetail: JSON.stringify({ email: provenance.email, phone: provenance.phone }), verified: false };
      const changed = await tx.contact.updateMany({ where: { companyId, fullName: 'Contacto general' }, data: contactData });
      if (!changed.count) await tx.contact.create({ data: { companyId, fullName: 'Contacto general', ...contactData, legalBasis: 'LEGITIMATE_INTEREST', consentStatus: 'PENDING' } });
    }
    await tx.companyEvidence.create({ data: { companyId: targetId, kind: ownWeb ? 'WEB_OWN' : 'MANUAL', confirmedBy: userId, data: JSON.parse(JSON.stringify({ confirmed: values, provenance })) as Prisma.InputJsonValue } });
    await tx.auditLog.create({ data: { userId, entityType: 'Company', entityId: targetId, action: 'ACCEPT_COMPANY' } });
    await enqueueCompany(tx, targetId);
    for (const contact of await tx.contact.findMany({ where: { companyId: targetId } })) await enqueueContact(tx, contact.id);
    return targetId;
  }, { timeout: 15_000 });
}

export async function discardCompany(db: PrismaClient, companyId: string, userId: string) {
  await db.$transaction(async tx => {
    const changed = await tx.company.updateMany({ where: { id: companyId, acceptanceStatus: 'PENDING' }, data: { acceptanceStatus: 'DISCARDED', pipelineStage: 'LOST', researchQueuedAt: null } });
    if (changed.count) await enqueuePipeline(tx, companyId, 'LOST', new Date().toISOString(), 'Descartada desde try! Comercial');
    if (changed.count) await tx.auditLog.create({ data: { userId, entityType: 'Company', entityId: companyId, action: 'DISCARD_COMPANY' } });
  });
}
