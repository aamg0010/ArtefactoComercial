import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isSafeTestDatabase } from './test-database';
import { deleteCompany, COMPANY_DELETED_REASON } from './company-delete';
import { isSuppressed } from './suppression';
import { enqueue, enqueueCompany } from './trygestion/outbox';
import { startTrygestionMock } from './trygestion/testing/mock-server';
import { processSyncOutbox, retryFailed } from './trygestion/sync';
import { TrygestionClient, TrygestionError } from './trygestion/client';

const url = process.env.TEST_DATABASE_URL;
const enabled = isSafeTestDatabase(url, process.env.DATABASE_URL);
describe.runIf(enabled)('borrado definitivo de empresas (Postgres de pruebas)', () => {
  const db = new PrismaClient({ datasources: { db: { url } } });
  let user: { id: string; role: 'SALES' };
  const ids: string[] = [];
  const create = async (remote = true) => {
    const id = `fase13-${crypto.randomUUID()}`; ids.push(id);
    return db.company.create({ data: { id, name: '[SIMULADA] Empresa Fase13', normalizedName: id, country: 'ES',
      city: 'Caspe', nifNit: id, website: 'https://fase13.invalid', priority: 'B',
      ...(remote ? { trygestionEmpresaId: `empresa-${id}`, trygestionOportunidadId: `op-${id}` } : {}),
    } });
  };
  const remove = (id: string) => deleteCompany(db, { companyId: id, confirmed: true, user });
  beforeAll(async () => {
    const row = await db.user.create({ data: { email: `fase13-${crypto.randomUUID()}@test.invalid`, role: 'SALES' } });
    user = { id: row.id, role: 'SALES' };
  });
  afterAll(async () => {
    await db.company.deleteMany({ where: { id: { in: ids } } });
    await db.auditLog.deleteMany({ where: { userId: user.id } });
    await db.syncOutbox.deleteMany({ where: { entityId: { in: ids } } });
    await db.suppressionList.deleteMany({ where: { reason: 'fase13-test' } });
    await db.user.delete({ where: { id: user.id } }); await db.$disconnect();
  });
  it('borra todas las relaciones, conserva bajas y auditoría mínima, salta pendientes y permite reimportar', async () => {
    const c = await create();
    const contact = await db.contact.create({ data: { companyId: c.id, fullName: 'Persona privada', email: 'privada@fase13.invalid' } });
    const script = await db.script.create({ data: { companyId: c.id, author: 'test', content: {} } });
    const cadence = await db.cadence.create({ data: { name: c.id, companyCadences: { create: { companyId: c.id, scriptId: script.id, startDate: new Date() } } }, include: { companyCadences: true } });
    const task = await db.task.create({ data: { companyId: c.id, type: 'CALL', title: 'Test', scriptId: script.id, companyCadenceId: cadence.companyCadences[0].id } });
    const activity = await db.activity.create({ data: { companyId: c.id, taskId: task.id, type: 'CALL', body: 'Texto privado' } });
    const report = await db.researchReport.create({ data: { companyId: c.id } });
    await db.score.create({ data: { companyId: c.id, researchReportId: report.id, total: 1, suggestedPriority: 'C', breakdown: {} } });
    const product = await db.product.create({ data: { name: c.id, line: c.id, description: 'test' } });
    await db.opportunity.create({ data: { companyId: c.id, productId: product.id } });
    await db.companySource.create({ data: { companyId: c.id, source: 'test', sourceRef: c.id } });
    await db.companyEvidence.create({ data: { companyId: c.id, kind: 'test', data: {}, confirmedBy: user.id } });
    await db.aiRun.create({ data: { companyId: c.id, provider: 'mock', model: 'mock', purpose: 'test', durationMs: 1, success: true } });
    await db.emailReply.create({ data: { companyId: c.id, taskId: task.id, trygestionId: c.id, fromEmail: 'test@fase13.invalid', subject: 'Privado', receivedAt: new Date(), method: 'hilo' } });
    await db.emailDispatch.create({ data: { companyId: c.id, taskId: task.id, approvedBy: 'test', contentHash: 'test', status: 'SENT', body: 'Email privado' } });
    const suppression = await db.suppressionList.create({ data: { companyId: c.id, email: 'baja@fase13.invalid', phone: '123-fase13', domain: 'fase13.invalid', reason: 'fase13-test' } });
    for (const [kind, entityId] of [['COMPANY_UPSERT', c.id], ['CONTACT_UPSERT', contact.id], ['ACTIVITY', activity.id], ['EVENT', activity.id], ['OPPORTUNITY_STAGE', c.id], ['OPPORTUNITY_STATUS', c.id]] as const) {
      await enqueue(db, kind, entityId, { companyId: c.id });
    }
    await db.syncOutbox.updateMany({ where: { entityId: contact.id }, data: { status: 'FAILED' } });
    expect(await remove(c.id)).toEqual({ deleted: true, name: c.name });
    for (const model of [db.contact, db.task, db.activity, db.script, db.researchReport, db.score, db.opportunity, db.companyCadence, db.companySource, db.companyEvidence, db.aiRun, db.emailReply, db.emailDispatch]) {
      expect(await (model.count as unknown as (args: { where: { companyId: string } }) => Promise<number>)({ where: { companyId: c.id } })).toBe(0);
    }
    expect(await db.company.findUnique({ where: { id: c.id } })).toBeNull();
    expect(await db.suppressionList.findUnique({ where: { id: suppression.id } })).toMatchObject({ companyId: null, email: suppression.email, phone: suppression.phone, domain: suppression.domain });
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: c.id, action: 'COMPANY_DELETED' } });
    expect(audit).toMatchObject({ entityType: 'Company', userId: user.id, metadata: { name: c.name, nifNit: c.nifNit, website: c.website, city: c.city, country: 'ES', pipelineStage: 'DETECTED', priority: 'B', counts: { contacts: 1, tasks: 1, activities: 1 }, trygestionEmpresaId: c.trygestionEmpresaId, trygestionOportunidadId: c.trygestionOportunidadId } });
    expect(JSON.stringify(audit)).not.toMatch(/Persona privada|Email privado|privada@/);
    const jobs = await db.syncOutbox.findMany({ where: { OR: [{ entityId: c.id }, { entityId: contact.id }, { entityId: activity.id }] } });
    expect(jobs.filter(j => j.kind !== 'OPPORTUNITY_CLOSE_DELETED')).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'SKIPPED', lastError: null })]));
    expect(jobs.every(j => j.kind === 'OPPORTUNITY_CLOSE_DELETED' || j.status === 'SKIPPED')).toBe(true);
    expect(jobs.find(j => j.kind === 'OPPORTUNITY_CLOSE_DELETED')?.payload).toEqual({ trygestionOportunidadId: c.trygestionOportunidadId, motivo: COMPANY_DELETED_REASON });
    await retryFailed(db);
    expect(await db.syncOutbox.count({ where: { entityId: contact.id, status: 'PENDING' } })).toBe(0);
    expect(await remove(c.id)).toEqual({ deleted: false });
    expect(await db.auditLog.count({ where: { entityId: c.id, action: 'COMPANY_DELETED' } })).toBe(1);
    const recreated = await db.company.create({ data: { id: c.id, name: c.name, normalizedName: c.normalizedName, nifNit: c.nifNit, website: c.website, country: c.country, city: c.city, sourceId: c.sourceId } });
    expect(await isSuppressed(db, recreated.id)).toBe(true);
    await db.companySource.create({ data: { companyId: recreated.id, source: 'test', sourceRef: c.id } });
    await db.company.delete({ where: { id: recreated.id } });
    await db.companySource.deleteMany({ where: { sourceRef: c.id } });
    await db.cadence.delete({ where: { id: cadence.id } }); await db.product.delete({ where: { id: product.id } });
  });
  it('sin oportunidad no encola cierre; dos envíos concurrentes son idempotentes', async () => {
    const c = await create(false);
    const results = await Promise.all([remove(c.id), remove(c.id)]);
    expect(results.filter(r => r.deleted)).toHaveLength(1);
    expect(await db.syncOutbox.count({ where: { entityId: c.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: c.id } })).toBe(1);
  });
  it('rechaza DIRECTOR, sin sesión, sin confirmar e ids no seguros', async () => {
    const c = await create(false);
    for (const change of [{ user: null }, { user: { id: user.id, role: 'DIRECTOR' as const } }, { confirmed: false }, { companyId: '../peligro' }, { companyId: 'x'.repeat(192) }]) {
      await expect(deleteCompany(db, { companyId: c.id, confirmed: true, user, ...change })).rejects.toThrow();
    }
    expect(await db.company.findUnique({ where: { id: c.id } })).not.toBeNull();
    expect(await db.auditLog.count({ where: { entityId: c.id } })).toBe(0);
  });
  it('un error revierte auditoría, outbox y borrado', async () => {
    const c = await create();
    await expect(deleteCompany(db, { companyId: c.id, confirmed: true, user: { id: 'usuario-inexistente', role: 'SALES' } })).rejects.toThrow();
    expect(await db.company.findUnique({ where: { id: c.id } })).not.toBeNull();
    expect(await db.syncOutbox.count({ where: { entityId: c.id } })).toBe(0);
  });
  it('espera al worker en curso y cierra la oportunidad que acaba de crear, sin recrear la empresa', async () => {
    const mock = await startTrygestionMock();
    const c = await create(false);
    const client = new TrygestionClient({ env: { TRYGESTION_URL: mock.url, TRYGESTION_TOKEN: mock.token } });
    let entered!: () => void; let release!: () => void;
    const entering = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = client.crearEmpresa.bind(client);
    vi.spyOn(client, 'crearEmpresa').mockImplementation(async (...args) => { entered(); await gate; return original(...args); });
    try {
      await enqueueCompany(db, c.id);
      const worker = processSyncOutbox(db, { client, companyId: c.id, now: new Date(Date.now() + 60_000) });
      await entering;
      const deleting = remove(c.id);
      release();
      await worker; await deleting;
      expect(mock.state.companies).toHaveLength(1);
      expect(mock.state.opportunities).toHaveLength(1);
      const close = await db.syncOutbox.findFirstOrThrow({ where: { entityId: c.id, kind: 'OPPORTUNITY_CLOSE_DELETED' } });
      expect(close.payload).toMatchObject({ trygestionOportunidadId: mock.state.opportunities[0].id });
      await processSyncOutbox(db, { client, companyId: c.id, now: new Date(Date.now() + 120_000) });
      expect(mock.state.opportunities[0]).toMatchObject({ estado: 'perdida', motivo_perdida: COMPANY_DELETED_REASON });
      expect(mock.state.companies).toHaveLength(1);
      expect(await db.company.findUnique({ where: { id: c.id } })).toBeNull();
    } finally { release(); await mock.close(); }
  });
  it.each([200, 404, 500])('el cierre no requiere empresa local: respuesta %s', async status => {
    const c = await create(); await remove(c.id);
    const client = new TrygestionClient({ env: { TRYGESTION_URL: 'http://127.0.0.1:1', TRYGESTION_TOKEN: 'mock' } });
    const change = vi.spyOn(client, 'cambiarEstado');
    if (status === 200) change.mockResolvedValue({ ok: true });
    else change.mockRejectedValue(new TrygestionError(`HTTP_${status}`, status));
    await processSyncOutbox(db, { client, companyId: c.id, now: new Date(Date.now() + 60_000) });
    expect(change).toHaveBeenCalledWith(c.trygestionOportunidadId, 'perdida', COMPANY_DELETED_REASON, expect.any(String));
    expect(await db.syncOutbox.findFirst({ where: { entityId: c.id, kind: 'OPPORTUNITY_CLOSE_DELETED' } })).toMatchObject({ status: status === 500 ? 'PENDING' : 'DONE' });
  });
});
