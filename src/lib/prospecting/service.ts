import { enqueueCompany } from '../trygestion/outbox';
import { Prisma, PrismaClient, type SearchProfile } from '@prisma/client';
import { z } from 'zod';
import { sourceAdapter } from '../sources';
import { candidateSchema, sourceNames, type CandidateCompany, type SourceAdapter } from '../sources/types';
import { GooglePlacesAdapter, SourceError } from '../sources/google-places';
import { normalizeDomain, normalizeText } from '../normalization';
import { companyWebsiteCandidate, corporateEmail } from '../company-contact';
import { osmAttribution } from '../sources/openstreetmap';
import { duplicateReason, normalizedBusinessName, normalizedPhone } from './deduplication';

const json = (data: unknown) => JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
type Tx = Prisma.TransactionClient;
export async function candidateSuppressed(tx: Tx, candidate: CandidateCompany) {
  const domain = normalizeDomain(candidate.website); const phone = normalizedPhone(candidate.corporatePhone, candidate.country);
  const exclusions = await tx.suppressionList.findMany({ include: { company: { include: { contacts: true } } } });
  return exclusions.some(row => {
    const company = row.company;
    const domains = [normalizeDomain(row.domain), company?.normalizedDomain, normalizeDomain(company?.website), normalizeDomain(companyWebsiteCandidate(row.email ?? ''))].filter(Boolean);
    if (domain && domains.includes(domain)) return true;
    const phones = [row.phone, company?.phone, ...company?.contacts.map(contact => contact.phone) ?? []];
    if (phone && phones.some(value => normalizedPhone(value, row.country ?? company?.country ?? candidate.country) === phone)) return true;
    const name = row.companyName ?? company?.name; const city = row.city ?? company?.city; const country = row.country ?? company?.country;
    return Boolean(name && country === candidate.country && normalizedBusinessName(name) === normalizedBusinessName(candidate.name) && normalizeText(city ?? '') === normalizeText(candidate.city));
  });
}
function companyData(candidate: CandidateCompany, profile: SearchProfile) {
  const google = candidate.source === 'google-places';
  const name = google ? `Empresa detectada · ${profile.name} · ${candidate.sourceRef}` : candidate.name;
  return {
    name, normalizedName: normalizeText(name), country: profile.country,
    city: google ? null : candidate.city, region: google ? null : candidate.province,
    comarca: profile.comarcas.length === 1 ? profile.comarcas[0] : null,
    address: google ? null : candidate.address, nifNit: google ? null : candidate.nif,
    website: google ? null : candidate.website, normalizedDomain: google ? null : normalizeDomain(candidate.website),
    phone: google ? null : candidate.corporatePhone, email: google ? null : corporateEmail(candidate.corporateEmail),
    sector: google ? profile.keywords.join(', ') : candidate.category,
    fictional: candidate.simulated, source: (google ? 'GOOGLE_PLACES' : candidate.source === 'csv' ? 'CSV' : 'OTHER') as 'GOOGLE_PLACES' | 'CSV' | 'OTHER',
    sourceDetail: `${candidate.source}: ${candidate.sourceRef}${candidate.source === 'openstreetmap' ? ` · ${osmAttribution}` : ''}`,
    acceptanceStatus: google ? 'PENDING' as const : 'ACCEPTED' as const,
    researchQueuedAt: google ? null : new Date(),
  };
}
async function ingest(db: PrismaClient, profile: SearchProfile, runId: string, candidate: CandidateCompany, liveGoogle: Map<string, CandidateCompany>, mayCreate: boolean) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(48104)`;
    const where = { source_sourceRef: { source: candidate.source, sourceRef: candidate.sourceRef } };
    const identity = await tx.companySource.findUnique({ where });
    if (identity?.blocked || await candidateSuppressed(tx, candidate)) return { outcome: 'SUPPRESSED', sourceRef: candidate.sourceRef };
    const rows = await tx.company.findMany({ include: { sourceIdentities: { select: { source: true, sourceRef: true } } } });
    rows.sort((a, b) => Number(a.acceptanceStatus !== 'ACCEPTED') - Number(b.acceptanceStatus !== 'ACCEPTED'));
    let existing: typeof rows[number] | undefined; let reason: string | null = null;
    for (const company of rows) {
      let match = duplicateReason({ ...candidate, nifNit: candidate.nif }, company);
      if (!match) for (const ref of company.sourceIdentities.filter(item => item.source === 'google-places')) {
        const live = liveGoogle.get(ref.sourceRef);
        if (live) match = duplicateReason({ ...candidate, nifNit: candidate.nif }, live);
        if (match) { match = `LIVE_${match}`; break; }
      }
      if (match) { existing = company; reason = match; break; }
    }
    const sourceData = { sourceUrl: candidate.source === 'google-places' ? null : candidate.sourceUrl, attribution: candidate.source === 'openstreetmap' ? osmAttribution : null, observedAt: new Date() };
    if (existing) {
      if (await tx.suppressionList.findFirst({ where: { companyId: existing.id } })) return { outcome: 'SUPPRESSED', sourceRef: candidate.sourceRef, companyId: existing.id };
      if (identity?.companyId && identity.companyId !== existing.id) {
        const old = rows.find(row => row.id === identity.companyId);
        if (old?.acceptanceStatus === 'PENDING') {
          const opportunities = await tx.opportunity.findMany({ where: { companyId: old.id } });
          for (const opportunity of opportunities) await tx.opportunity.upsert({ where: { companyId_productId: { companyId: existing.id, productId: opportunity.productId } }, update: {}, create: { companyId: existing.id, productId: opportunity.productId } });
          await tx.companySource.updateMany({ where: { companyId: old.id }, data: { companyId: existing.id } });
          await tx.company.delete({ where: { id: old.id } });
        }
      }
      if (existing.acceptanceStatus === 'PENDING' && candidate.source !== 'google-places' && !candidate.simulated) {
        await tx.company.update({ where: { id: existing.id }, data: companyData(candidate, profile) });
        const contact = { phone: candidate.corporatePhone, email: candidate.corporateEmail, source: candidate.source === 'csv' ? 'CSV' as const : 'OTHER' as const, verified: false, sourceDetail: candidate.attribution ?? 'Datos corporativos de lista propia' };
        const updated = await tx.contact.updateMany({ where: { companyId: existing.id, fullName: 'Contacto general' }, data: contact });
        if (!updated.count) await tx.contact.create({ data: { companyId: existing.id, fullName: 'Contacto general', ...contact, legalBasis: 'LEGITIMATE_INTEREST', consentStatus: 'PENDING' } });
      }
      await tx.companySource.upsert({ where, update: { companyId: existing.id, ...sourceData }, create: { source: candidate.source, sourceRef: candidate.sourceRef, companyId: existing.id, ...sourceData } });
      await enqueueCompany(tx, existing.id);
      return { outcome: 'DUPLICATE', reason, sourceRef: candidate.sourceRef, companyId: existing.id };
    }
    if (!mayCreate) return { outcome: 'LIMIT', sourceRef: candidate.sourceRef };
    const data = companyData(candidate, profile);
    const company = await tx.company.create({ data: { ...data, pipelineStage: 'DETECTED', priority: null, detectedAt: new Date(), discoveryRunId: runId,
      contacts: { create: { fullName: 'Contacto general', phone: data.phone, email: data.email, source: data.source, verified: false, legalBasis: 'LEGITIMATE_INTEREST', consentStatus: 'PENDING', sourceDetail: `interés legítimo B2B sobre datos corporativos públicos (revisar)${candidate.attribution ? ` · ${candidate.attribution}` : ''}` } },
    } });
    await tx.companySource.upsert({ where, update: { companyId: company.id, ...sourceData }, create: { source: candidate.source, sourceRef: candidate.sourceRef, companyId: company.id, ...sourceData } });
    const product = await tx.product.findUnique({ where: { line: profile.productLine } });
    if (product) await tx.opportunity.create({ data: { companyId: company.id, productId: product.id } });
    await enqueueCompany(tx, company.id);
    return { outcome: 'CREATED', sourceRef: candidate.sourceRef, companyId: company.id };
  }, { timeout: 15_000 });
}

type Options = {
  db?: PrismaClient; adapter?: SourceAdapter; adapters?: Partial<Record<typeof sourceNames[number], SourceAdapter>>;
  googleDetails?: (id: string, country: 'ES' | 'CO') => Promise<CandidateCompany | null>;
};
export async function runProspecting(profileId?: string, options: Options = {}) {
  const db = options.db ?? new PrismaClient();
  // Request-local only. Never persist Google's names/domains/phones as a dedup index.
  const liveGoogle = new Map<string, CandidateCompany>();
  try {
    const profiles = await db.searchProfile.findMany({ where: { active: true, ...(profileId ? { id: profileId } : {}) }, orderBy: { id: 'asc' } });
    const completed = [];
    for (const profile of profiles) {
      const queries: string[] = []; const matches: object[] = []; const errors: string[] = [];
      let adapters: SourceAdapter[];
      try {
        adapters = options.adapter ? [options.adapter] : [...new Map((profile.sources.length ? profile.sources : [profile.source]).map(raw => {
          const source = z.enum(sourceNames).parse(raw); const adapter = options.adapters?.[source] ?? sourceAdapter(source, db); return [adapter.id, adapter] as const;
        })).values()];
      } catch { adapters = [{ id: 'google-places', search: async () => { throw new SourceError('SOURCE_CONFIGURATION_INVALID'); } }]; }
      const run = await db.sourceRun.create({ data: { profileId: profile.id, source: adapters.map(adapter => adapter.id).join(' + '), queries: [], matches: [], errorCodes: [] } });
      const candidates: CandidateCompany[] = []; let created = 0; let duplicates = 0; let suppressed = 0;
      for (const adapter of adapters) {
        try {
          const found = await adapter.search({ ...profile, maxResults: Math.min(200, Math.max(1, profile.maxResults)), csvCandidates: profile.csvCandidates, onQuery: query => queries.push(`${adapter.id}: ${query}`) });
          for (const raw of found.slice(0, profile.maxResults)) {
            const candidate = candidateSchema.parse(raw); candidates.push(candidate);
            if (candidate.source === 'google-places') liveGoogle.set(candidate.sourceRef, candidate);
          }
        } catch (error) { errors.push(error instanceof SourceError ? error.code : error instanceof Error && error.message.startsWith('SOURCE_NOT_IMPLEMENTED:') ? error.message : 'SOURCE_SEARCH_ERROR'); }
      }
      // Read missing Google-only identities live, outside every SQL transaction.
      if (candidates.some(candidate => candidate.source !== 'google-places')) {
        const pending = await db.companySource.findMany({ where: { source: 'google-places', company: { acceptanceStatus: { not: 'ACCEPTED' } } }, include: { company: { select: { country: true } } } });
        for (const identity of pending) if (!liveGoogle.has(identity.sourceRef) && identity.company) {
          try {
            const read = options.googleDetails ?? (async (id: string, country: 'ES' | 'CO') => process.env.GOOGLE_PLACES_API_KEY?.trim() ? new GooglePlacesAdapter(process.env.GOOGLE_PLACES_API_KEY).details(id, country) : null);
            const result = await read(identity.sourceRef, identity.company.country); if (result) liveGoogle.set(identity.sourceRef, result);
          } catch { errors.push('GOOGLE_LIVE_DEDUP_UNAVAILABLE'); }
        }
      }
      // Independently licensed sources first; Google's transient metadata can
      // still match them regardless of the order selected in the profile.
      candidates.sort((a, b) => Number(a.source === 'google-places') - Number(b.source === 'google-places'));
      for (const candidate of candidates) {
        try {
          const result = await ingest(db, profile, run.id, candidate, liveGoogle, created < profile.maxResults);
          matches.push({ ...result, source: candidate.source });
          if (result.outcome === 'CREATED') created++; else if (result.outcome === 'DUPLICATE') duplicates++; else if (result.outcome === 'SUPPRESSED') suppressed++;
        } catch (error) { errors.push(error instanceof Prisma.PrismaClientKnownRequestError ? `CANDIDATE_${error.code}` : 'CANDIDATE_PROCESSING_ERROR'); }
      }
      completed.push(await db.sourceRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), status: errors.length ? created || duplicates || suppressed ? 'PARTIAL' : 'ERROR' : 'SUCCESS', queries: json(queries), matches: json(matches), errorCodes: json(errors), errors: errors.length, candidates: candidates.length, created, duplicates, suppressed } }));
    }
    return completed;
  } finally { if (!options.db) await db.$disconnect(); }
}
