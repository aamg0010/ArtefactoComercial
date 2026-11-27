import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { acceptanceInput, safeCompanyId, verifyProposal } from './acceptance';
import { businessPhone, corporateEmail } from '../company-contact';
import { normalizeDomain } from '../normalization';
import { normalizedPhone } from './deduplication';
import { enqueueCompany } from '../trygestion/outbox';

export const completionFields = ['website', 'phone', 'email'] as const;
const inputSchema = acceptanceInput.pick({ website: true, phone: true, email: true, confirmed: true }).extend({
  replace: z.array(z.enum(completionFields)).default([]),
});

export async function completeCompanyWebsite(db: PrismaClient, companyId: string, raw: unknown, proof: string, user: { id?: string; role?: string }) {
  if (!user.id || user.role === 'DIRECTOR') throw new Error('No autorizado');
  safeCompanyId.parse(companyId);
  const proposal = verifyProposal(proof, companyId);
  if (proposal?.purpose !== 'complete-web' || !proposal.baseline) throw new Error('PROPOSAL_INVALID');
  const input = inputSchema.parse(raw);
  return db.$transaction(async tx => {
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    if (company.acceptanceStatus !== 'ACCEPTED') throw new Error('COMPANY_STATUS');
    const submitted = { website: input.website || null, phone: businessPhone(input.phone), email: corporateEmail(input.email) };
    const data: Partial<typeof submitted> & { normalizedDomain?: string | null } = {};
    const confirmed: Record<string, string> = {};
    const provenance: Record<string, { kind: string; url?: string; date: string }> = {};
    for (const field of completionFields) {
      // Existing values require explicit replacement; concurrent edits require a new review.
      const value = submitted[field];
      if (!value || value === company[field] || (company[field] && !input.replace.includes(field))) continue;
      if (company[field] !== proposal.baseline![field]) throw new Error('COMPANY_CHANGED');
      data[field] = value;
      confirmed[field] = value;
      const claim = proposal.fields[field];
      const matches = claim && (field === 'phone' ? normalizedPhone(value, company.country) === normalizedPhone(claim.value, company.country) : field === 'website' ? new URL(value).href === new URL(claim.value).href : value.toLowerCase() === claim.value.toLowerCase());
      provenance[field] = matches ? { kind: 'web propia', url: claim.url, date: claim.date } : { kind: 'confirmado manualmente', date: new Date().toISOString() };
    }
    if ('website' in data) data.normalizedDomain = normalizeDomain(data.website);
    if (!Object.keys(confirmed).length) return;
    await tx.company.update({ where: { id: companyId }, data });
    await tx.companyEvidence.create({ data: { companyId, kind: Object.values(provenance).some(p => p.kind === 'web propia') ? 'WEB_OWN' : 'MANUAL', confirmedBy: user.id!, data: { confirmed, provenance } as Prisma.InputJsonValue } });
    await tx.auditLog.create({ data: { userId: user.id, entityType: 'Company', entityId: companyId, action: 'COMPLETE_FROM_WEBSITE', metadata: { fields: Object.keys(confirmed) } } });
    await enqueueCompany(tx, companyId);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
