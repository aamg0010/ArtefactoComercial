import { Prisma, PrismaClient, type SearchProfile } from '@prisma/client';
import { z } from 'zod';
import { sourceAdapter } from '../sources';
import { candidateSchema, sourceNames, type CandidateCompany, type SourceAdapter } from '../sources/types';
import { SourceError } from '../sources/google-places';
import { normalizeDomain, normalizeText } from '../normalization';
import { companyWebsiteCandidate } from '../company-contact';
import { duplicateReason, normalizedBusinessName, normalizedPhone } from './deduplication';

const json = (data: unknown) => JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
type Tx = Prisma.TransactionClient;
async function candidateSuppressed(tx: Tx, candidate: CandidateCompany) {
  const domain = normalizeDomain(candidate.website);
  const phone = normalizedPhone(candidate.corporatePhone, candidate.country);
  const exclusions = await tx.suppressionList.findMany({ include: { company: { include: { contacts: true } } } });
  return exclusions.some(row => {
    const company = row.company;
    const domains = [normalizeDomain(row.domain), company?.normalizedDomain, normalizeDomain(company?.website), normalizeDomain(companyWebsiteCandidate(row.email ?? ''))].filter(Boolean);
    if (domain && domains.includes(domain)) return true;
    const phones = [row.phone, company?.phone, ...company?.contacts.map(contact => contact.phone) ?? []];
    if (phone && phones.some(value => normalizedPhone(value, row.country ?? company?.country ?? candidate.country) === phone)) return true;
    const name = row.companyName ?? company?.name;
    const city = row.city ?? company?.city;
    const country = row.country ?? company?.country;
    return Boolean(name && country === candidate.country && normalizedBusinessName(name) === normalizedBusinessName(candidate.name) && normalizeText(city ?? '') === normalizeText(candidate.city));
  });
}

async function ingest(db: PrismaClient, profile: SearchProfile, runId: string, candidate: CandidateCompany) {
  return db.$transaction(async tx => {
    // Serialize only the local dedup/create section, never the external API call.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(48104)`;
    const where = { source_sourceRef: { source: candidate.source, sourceRef: candidate.sourceRef } };
    const identity = await tx.companySource.findUnique({ where });
    if (identity?.blocked || await candidateSuppressed(tx, candidate)) return { outcome: 'SUPPRESSED', sourceRef: candidate.sourceRef };
    const rows = await tx.company.findMany({ include: { sourceIdentities: { select: { source: true, sourceRef: true } } } });
    let existing: typeof rows[number] | undefined;
    let reason: string | null = null;
    for (const company of rows) {
      const match = duplicateReason({ ...candidate, nifNit: candidate.nif }, company);
      if (match) { existing = company; reason = match; break; }
    }
    if (existing) {
      const excluded = await tx.suppressionList.findFirst({ where: { companyId: existing.id } });
      if (excluded) return { outcome: 'SUPPRESSED', sourceRef: candidate.sourceRef, companyId: existing.id };
      await tx.companySource.upsert({ where, update: { companyId: existing.id }, create: { source: candidate.source, sourceRef: candidate.sourceRef, companyId: existing.id } });
      return { outcome: 'DUPLICATE', reason, sourceRef: candidate.sourceRef, companyId: existing.id };
    }
    // Google content is transient. Persist only its exempt place_id and our own
    // profile metadata, not a directory/cache of Google business names/phones.
    const google = candidate.source === 'google-places';
    const name = google ? `Empresa detectada · ${profile.name} · ${candidate.sourceRef}` : candidate.name;
    const source = google ? 'GOOGLE_PLACES' : candidate.source === 'csv' ? 'CSV' : 'OTHER';
    const company = await tx.company.create({ data: {
      name, normalizedName: normalizeText(name), country: profile.country,
      city: google ? null : candidate.city, region: google ? null : candidate.province,
      comarca: profile.comarcas.length === 1 ? profile.comarcas[0] : null,
      address: google ? null : candidate.address, nifNit: google ? null : candidate.nif,
      website: google ? null : candidate.website, normalizedDomain: google ? null : normalizeDomain(candidate.website),
      phone: google ? null : candidate.corporatePhone, sector: google ? profile.keywords.join(', ') : candidate.category,
      fictional: candidate.simulated, pipelineStage: 'DETECTED', priority: null, source,
      sourceDetail: `${candidate.source}: ${candidate.sourceRef}`, detectedAt: new Date(), researchQueuedAt: new Date(), discoveryRunId: runId,
      contacts: { create: { fullName: 'Contacto general', phone: google ? null : candidate.corporatePhone, source,
        verified: false, legalBasis: 'LEGITIMATE_INTEREST', consentStatus: 'PENDING', sourceDetail: 'interés legítimo B2B sobre datos corporativos públicos (revisar)' } },
    } });
    await tx.companySource.upsert({ where, update: { companyId: company.id }, create: { source: candidate.source, sourceRef: candidate.sourceRef, companyId: company.id } });
    const product = await tx.product.findUnique({ where: { line: profile.productLine } });
    if (product) await tx.opportunity.create({ data: { companyId: company.id, productId: product.id } });
    return { outcome: 'CREATED', sourceRef: candidate.sourceRef, companyId: company.id };
  }, { timeout: 15_000 });
}

export async function runProspecting(profileId?: string, options: { db?: PrismaClient; adapter?: SourceAdapter } = {}) {
  const db = options.db ?? new PrismaClient();
  try {
    const profiles = await db.searchProfile.findMany({ where: { active: true, ...(profileId ? { id: profileId } : {}) }, orderBy: { id: 'asc' } });
    const completed = [];
    for (const profile of profiles) {
      const queries: string[] = []; const matches: object[] = []; const errors: string[] = [];
      let adapter: SourceAdapter;
      try { adapter = options.adapter ?? sourceAdapter(z.enum(sourceNames).parse(profile.source)); }
      catch { adapter = { id: 'google-places', search: async () => { throw new SourceError('SOURCE_CONFIGURATION_INVALID'); } }; }
      const run = await db.sourceRun.create({ data: { profileId: profile.id, source: adapter.id, queries: [], matches: [], errorCodes: [] } });
      let candidatesCount = 0; let created = 0; let duplicates = 0; let suppressed = 0;
      try {
        const candidates = await adapter.search({ ...profile, maxResults: Math.min(200, Math.max(1, profile.maxResults)), csvCandidates: profile.csvCandidates, onQuery: query => queries.push(query) });
        candidatesCount = candidates.length;
        for (const raw of candidates.slice(0, profile.maxResults)) {
          try {
            const candidate = candidateSchema.parse(raw);
            const result = await ingest(db, profile, run.id, candidate);
            matches.push(result);
            if (result.outcome === 'CREATED') created++;
            else if (result.outcome === 'DUPLICATE') duplicates++;
            else suppressed++;
          } catch (error) { errors.push(error instanceof Prisma.PrismaClientKnownRequestError ? `CANDIDATE_${error.code}` : 'CANDIDATE_PROCESSING_ERROR'); }
        }
      } catch (error) { errors.push(error instanceof SourceError ? error.code : error instanceof Error && error.message.startsWith('SOURCE_NOT_IMPLEMENTED:') ? error.message : 'SOURCE_SEARCH_ERROR'); }
      completed.push(await db.sourceRun.update({ where: { id: run.id }, data: {
        finishedAt: new Date(), status: errors.length ? created || duplicates || suppressed ? 'PARTIAL' : 'ERROR' : 'SUCCESS',
        queries: json(queries), matches: json(matches), errorCodes: json(errors), errors: errors.length, candidates: candidatesCount, created, duplicates, suppressed,
      } }));
    }
    return completed;
  } finally { if (!options.db) await db.$disconnect(); }
}
