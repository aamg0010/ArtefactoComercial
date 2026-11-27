import { afterEach, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { prepareWebsiteProposal, signProposal, type AcceptanceProposal } from './acceptance';
import { completeCompanyWebsite } from './complete-web';
import { crawlCompanyWebsite } from '../research/crawler';

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
const company = { id: 'accepted', country: 'ES', acceptanceStatus: 'ACCEPTED', website: null, phone: '978111111', email: null, sourceIdentities: [{ source: 'google-places', sourceRef: 'place' }] };
const date = '2026-11-27T10:00:00.000Z';
const claim = (value: string) => ({ value, url: 'https://own.test/', date });
function fixture() {
  vi.stubEnv('AUTH_SECRET', 'test-complete-secret');
  const row = { ...company };
  const tx = {
    company: { findUniqueOrThrow: vi.fn(async () => row), findUnique: vi.fn(async () => row), update: vi.fn(async ({ data }) => Object.assign(row, data)) },
    companyEvidence: { create: vi.fn() }, auditLog: { create: vi.fn() }, syncOutbox: { upsert: vi.fn() },
  };
  const db = { ...tx, $transaction: vi.fn(async fn => fn(tx)) } as unknown as PrismaClient;
  const proposal: AcceptanceProposal = { companyId: company.id, purpose: 'complete-web', expires: Date.now() + 900_000, baseline: { website: null, phone: company.phone, email: null }, fields: { website: claim('https://own.test/'), email: claim('info@own.test'), phone: claim('978222222') } };
  return { db, tx, row, proposal, proof: signProposal(proposal) };
}
const input = { website: 'https://own.test/', phone: '978222222', email: 'info@own.test', confirmed: true };
const user = { id: 'sales', role: 'SALES' };

it('prepara para aceptada solo valores de la web propia, nunca teléfono, dirección o nombre de Google', async () => {
  const { db } = fixture();
  const details = vi.fn().mockResolvedValue({ website: 'https://own.test', corporatePhone: '978999999', address: 'Google address', name: 'Google name', city: 'Google city' });
  const crawl = vi.fn().mockResolvedValue({ sources: [{ url: 'https://own.test/', date }], business: [{ email: 'info@own.test', url: 'https://own.test/contacto', date }], note: 'ok' });
  const result = await prepareWebsiteProposal(db, company.id, 'complete-web', { details, crawl });
  expect(result.proposal.fields).toEqual({ website: claim('https://own.test/'), email: { value: 'info@own.test', url: 'https://own.test/contacto', date } });
  expect(JSON.stringify(result.proposal)).not.toContain('Google');
  expect(crawl).toHaveBeenCalledWith('https://own.test', undefined, expect.objectContaining({ signal: expect.any(AbortSignal) }));
});
it('prioriza web registrada sin pedir Google y deja vacíos los datos ausentes', async () => {
  const { db, row } = fixture(); Object.assign(row, { website: 'https://registered.test' });
  const details = vi.fn(); const crawl = vi.fn().mockResolvedValue({ sources: [], note: 'no data' });
  const result = await prepareWebsiteProposal(db, company.id, 'complete-web', { details, crawl });
  expect(details).not.toHaveBeenCalled(); expect(result.proposal.fields).toEqual({});
});
it('guarda WEB_OWN con URL y fecha verificadas, conserva teléfono existente y encola sincronización', async () => {
  const { db, tx, proof } = fixture();
  await completeCompanyWebsite(db, company.id, input, proof, user);
  expect(tx.company.update).toHaveBeenCalledWith({ where: { id: company.id }, data: { website: input.website, email: input.email, normalizedDomain: 'own.test' } });
  expect(tx.companyEvidence.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'WEB_OWN', confirmedBy: user.id, data: { confirmed: { website: input.website, email: input.email }, provenance: { website: { kind: 'web propia', url: 'https://own.test/', date }, email: { kind: 'web propia', url: 'https://own.test/', date } } } }) });
  expect(tx.auditLog.create).toHaveBeenCalled(); expect(tx.syncOutbox.upsert).toHaveBeenCalled();
});
it('solo sustituye confirmados con autorización explícita y marca cambios como manuales', async () => {
  const { db, tx, proof } = fixture();
  await completeCompanyWebsite(db, company.id, { ...input, phone: '978333333', replace: ['phone'] }, proof, user);
  expect(tx.company.update.mock.calls[0][0].data.phone).toBe('978333333');
  expect(tx.companyEvidence.create.mock.calls[0][0].data.data.provenance.phone).toMatchObject({ kind: 'confirmado manualmente' });
});
it.each(['expired', 'other', 'tampered', 'acceptance'])('rechaza proof %s sin escribir', async kind => {
  const { db, tx, proposal, proof } = fixture();
  const token = kind === 'expired' ? signProposal({ ...proposal, expires: 0 }) : kind === 'other' ? signProposal({ ...proposal, companyId: 'other' }) : kind === 'acceptance' ? signProposal({ ...proposal, purpose: undefined }) : proof + 'x';
  await expect(completeCompanyWebsite(db, company.id, input, token, user)).rejects.toThrow('PROPOSAL_INVALID');
  expect(tx.company.update).not.toHaveBeenCalled();
});
it.each([{ id: 'director', role: 'DIRECTOR' }, {}])('rechaza permisos insuficientes antes de leer o escribir', async denied => {
  const { db, tx, proof } = fixture();
  await expect(completeCompanyWebsite(db, company.id, input, proof, denied)).rejects.toThrow('No autorizado');
  expect(tx.company.findUniqueOrThrow).not.toHaveBeenCalled();
});
it('rechaza cambios concurrentes y no pisa datos de otra revisión', async () => {
  const { db, row, tx, proof } = fixture(); row.phone = '978444444';
  await expect(completeCompanyWebsite(db, company.id, { ...input, replace: ['phone'] }, proof, user)).rejects.toThrow('COMPANY_CHANGED');
  expect(tx.company.update).not.toHaveBeenCalled();
});
it('limita preparación a 38 s y cancela dependencias lentas', async () => {
  vi.useFakeTimers(); const { db } = fixture(); let aborted: AbortSignal | undefined;
  const details = vi.fn(async (_id: string, _country: 'ES' | 'CO', signal?: AbortSignal) => { aborted = signal; await new Promise(resolve => setTimeout(resolve, 7_900)); return { name: 'Google', website: 'https://own.test', country: 'ES' as const, city: '', province: '', address: null, corporatePhone: null, category: '', source: 'google-places' as const, sourceRef: 'place', sourceUrl: null, simulated: true }; });
  const crawl = vi.fn(() => new Promise<never>(() => {}));
  const pending = prepareWebsiteProposal(db, company.id, 'complete-web', { details, crawl });
  await vi.advanceTimersByTimeAsync(38_000);
  expect((await pending).proposal.fields).toEqual({}); expect(aborted?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it('el crawler corta peticiones simuladas que no responden dentro del presupuesto', async () => {
  vi.useFakeTimers();
  const request = vi.fn(() => new Promise<never>(() => {}));
  const pending = crawlCompanyWebsite('https://own.test', request, { budgetMs: 1_000 });
  await vi.advanceTimersByTimeAsync(1_000);
  expect((await pending).sources).toEqual([]); expect(request).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
