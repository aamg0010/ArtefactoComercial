import type { PrismaClient, Prisma } from '@prisma/client';
import { normalizeDomain, normalizeText } from './normalization';
import { normalizedBusinessName, normalizedPhone } from './prospecting/deduplication';

export async function isSuppressed(prisma: PrismaClient | Prisma.TransactionClient, companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId }, include: { contacts: true } });
  if (!company) return true;
  const identifiers = [company, ...company.contacts];
  const emails = identifiers.map(item => item.email?.toLowerCase()).filter(Boolean);
  const phones = identifiers.map(item => normalizedPhone(item.phone, company.country)).filter(Boolean);
  const domain = company.normalizedDomain || normalizeDomain(company.website);
  const exclusions = await prisma.suppressionList.findMany();
  return exclusions.some(row => row.companyId === companyId ||
    Boolean(row.email && emails.includes(row.email.toLowerCase())) ||
    Boolean(row.phone && phones.includes(normalizedPhone(row.phone, row.country ?? company.country))) ||
    Boolean(domain && normalizeDomain(row.domain) === domain) ||
    Boolean(row.companyName && row.country === company.country && normalizedBusinessName(row.companyName) === normalizedBusinessName(company.name) && normalizeText(row.city ?? '') === normalizeText(company.city ?? '')));
}
