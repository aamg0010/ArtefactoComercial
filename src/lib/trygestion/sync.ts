import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient, type SyncOutbox } from '@prisma/client';
import { z } from 'zod';
import { TrygestionClient, TrygestionError, type EventoInput } from './client';
import { enqueueCompany, enqueueContact } from './outbox';
import { normalizeDomain, normalizeText } from '../normalization';
import { companyWebsiteCandidate } from '../company-contact';
import { appCompanyUrl } from './links';

/** Default stages created by trygestión's `POST /pipeline/inicializar-etapas`. Won/lost use PUT …/estado, which picks the final stage. */
export const defaultStageMap: Record<string, string> = { DETECTED: 'Prospecto', RESEARCHED: 'Prospecto', CONTACTING: 'Contacto inicial', MEETING: 'Contacto inicial', PROPOSAL: 'Propuesta enviada', NEGOTIATION: 'Negociacion' };
export async function stageId(client: TrygestionClient, stage: string, value = process.env.TRYGESTION_STAGE_MAP) {
  let mapping = defaultStageMap;
  if (value?.trim()) try { mapping = { ...mapping, ...z.record(z.string().min(1)).parse(JSON.parse(value)) }; } catch { throw new TrygestionError('INVALID_STAGE_MAP'); }
  const name = mapping[stage]; if (!name) throw new TrygestionError(`STAGE_NOT_MAPPED:${stage}`);
  const rows = await client.etapas(); const found = rows.filter(item => normalizeText(item.nombre) === normalizeText(name));
  if (found.length !== 1) throw new TrygestionError(`STAGE_NOT_FOUND:${name}`);
  return found[0].id;
}
export const backoffMs = (attempts: number) => Math.min(2 * 60 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1));
class Deferred extends Error {}
class Skipped extends Error {}
const payloadSchema = z.object({ companyId: z.string().optional(), stage: z.string().optional(), estado: z.enum(['ganada', 'perdida']).optional(), motivo: z.string().optional(), event: z.unknown().optional(), emails: z.array(z.string()).optional(), domains: z.array(z.string()).optional(), trygestionOportunidadId: z.string().optional(), trygestionContactoId: z.string().optional() });
const eventSchema = z.object({ titulo: z.string().min(1), descripcion: z.string(), fecha_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), fecha_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), tipo: z.string(), ambito: z.literal('externo'), ubicacion: z.string(), entidad_externa: z.string() });
const ORIGIN_LINE = 'Origen: try! Comercial · prospecto · prioridad ';
const LINK_LINE = 'Ficha en try! Comercial: ';
/** Lines owned by try! Comercial in `notas` (the rest belongs to the people using trygestión and is kept as is). */
export function originNotes(notes: string | null | undefined, priority: string | null, companyId?: string) {
  const link = companyId ? appCompanyUrl(companyId) : null;
  const kept = (notes ?? '').split('\n').filter(line => line && !line.startsWith(ORIGIN_LINE) && !line.startsWith(LINK_LINE));
  return [...kept, `${ORIGIN_LINE}${priority ?? 'sin asignar'}`, ...(link ? [`${LINK_LINE}${link}`] : [])].join('\n');
}
export function opportunityDescription(companyId: string) {
  const link = appCompanyUrl(companyId);
  return `Oportunidad creada desde try! Comercial (${opportunityReference(companyId)}).${link ? `\n${LINK_LINE}${link}` : ''}`;
}
export const opportunityReference = (companyId: string) => `ref try-comercial:${companyId}`;
/** trygestión validates `web` as a full URL (or empty). */
export function remoteWebsite(value: string | null | undefined) {
  const candidate = value?.trim(); if (!candidate) return null;
  try { const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`); return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null; } catch { return null; }
}
async function linkCompany(db: PrismaClient, id: string, remoteId: string) {
  const other = await db.company.findFirst({ where: { trygestionEmpresaId: remoteId, id: { not: id } }, select: { id: true } });
  if (other) throw new TrygestionError('REMOTE_COMPANY_ALREADY_LINKED');
  await db.company.update({ where: { id }, data: { trygestionEmpresaId: remoteId } });
}
async function companyUpsert(db: PrismaClient, id: string, client: TrygestionClient, key: string) {
  let company = await db.company.findUnique({ where: { id }, include: { scores: { orderBy: { createdAt: 'desc' }, take: 1 }, contacts: true } });
  if (!company || company.acceptanceStatus !== 'ACCEPTED') throw new Skipped('COMPANY_NOT_ACCEPTED_OR_DELETED');
  // Las empresas simuladas (datos de prueba) nunca se envían a trygestión.
  if (company.fictional) throw new Skipped('FICTIONAL_COMPANY');
  let remote = company.trygestionEmpresaId ? await client.empresa(company.trygestionEmpresaId) : await client.buscarEmpresa({ cif: company.nifNit, web: company.website, nombre: company.name });
  if (!remote) {
    const created = await client.crearEmpresa({ nombre: company.name, cif: company.nifNit, web: remoteWebsite(company.website), ciudad: company.city, provincia: company.region, pais: company.country, telefono: company.phone, email: company.email, sector: company.sector, notas: originNotes(null, company.priority, company.id) }, `${key}:company`);
    await linkCompany(db, id, created.id);
    // A repeated CIF links to the client that already exists; its data is then treated like any existing client.
    remote = 'linkedExisting' in created ? await client.empresa(created.id) : { id: created.id, nombre: company.name, notas: originNotes(null, company.priority, company.id) };
  } else await linkCompany(db, id, remote.id);
  {
    const notes = originNotes(remote.notas, company.priority, company.id);
    // Existing clients keep all their data: only the origin line in `notas` is owned by try! Comercial.
    if (notes !== (remote.notas ?? '')) await client.actualizarEmpresa(remote, { notas: notes }, `${key}:notes`);
  }
  company = await db.company.findUniqueOrThrow({ where: { id }, include: { scores: { orderBy: { createdAt: 'desc' }, take: 1 }, contacts: true } });
  const probability = company.scores[0]?.total ?? ({ A: 70, B: 50, C: 25 }[company.priority ?? ''] ?? 0);
  if (!company.trygestionOportunidadId) {
    // Readable title for the people working in trygestión; the stable reference goes in the description.
    const etapa_id = await stageId(client, 'DETECTED'); const reference = opportunityReference(company.id);
    const existing = await client.buscarOportunidad(remote.id, reference, `Prospección try! Comercial [${company.id}]`);
    const opportunity = existing ?? await client.crearOportunidad({ titulo: `Prospección · ${company.name}`.slice(0, 250), descripcion: opportunityDescription(company.id), empresa_id: remote.id, etapa_id, probabilidad: probability }, `${key}:opportunity`);
    await db.company.update({ where: { id }, data: { trygestionOportunidadId: opportunity.id } });
  } else await client.actualizarOportunidad(company.trygestionOportunidadId, probability, `${key}:probability`, opportunityDescription(company.id));
  await db.company.update({ where: { id }, data: { trygestionSyncedAt: new Date() } });
  for (const contact of company.contacts) await enqueueContact(db, contact.id);
}
async function dependency(db: PrismaClient, companyId: string | undefined) {
  if (!companyId) throw new Skipped('LOCAL_ENTITY_DELETED');
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) throw new Skipped('LOCAL_ENTITY_DELETED');
  if (!company.trygestionOportunidadId || !company.trygestionEmpresaId) {
    if (company.acceptanceStatus !== 'ACCEPTED') throw new Skipped('UNACCEPTED_NOT_SYNCED');
    await enqueueCompany(db, company.id); throw new Deferred('WAITING_COMPANY_UPSERT');
  }
  return company;
}
async function perform(db: PrismaClient, job: SyncOutbox, client: TrygestionClient) {
  const payload = payloadSchema.parse(job.payload); const key = job.idempotencyKey;
  if (job.kind === 'OPPORTUNITY_CLOSE_DELETED') {
    const id = z.string().min(1).parse(payload.trygestionOportunidadId);
    const reason = z.string().min(1).parse(payload.motivo);
    try { await client.cambiarEstado(id, 'perdida', reason, key); } catch (error) {
      if (!(error instanceof TrygestionError && error.status === 404)) throw error;
    }
    return;
  }
  if (job.kind === 'COMPANY_UPSERT') return companyUpsert(db, job.entityId, client, key);
  if (job.kind === 'SUPPRESSION') {
    const company = await db.company.findUnique({ where: { id: payload.companyId ?? job.entityId }, include: { contacts: true } });
    const emails = [...new Set([...(payload.emails ?? []), company?.email, ...company?.contacts.map(contact => contact.email) ?? []].filter((value): value is string => Boolean(value)))];
    const domains = [...new Set([...(payload.domains ?? []), normalizeDomain(company?.website), ...emails.map(email => normalizeDomain(companyWebsiteCandidate(email)))].filter((value): value is string => Boolean(value)))];
    if (!emails.length && !domains.length) throw new Skipped('SUPPRESSION_NO_EMAIL_OR_DOMAIN');
    for (const [type, values] of [['email', emails], ['dominio', domains]] as const) for (const value of values) await client.suprimir({ [type]: value, motivo: payload.motivo ?? 'Baja solicitada desde try! Comercial' }, `${key}:${type}:${createHash('sha256').update(value).digest('hex')}`);
    return;
  }
  if (job.kind === 'CONTACT_DELETE') {
    if (!payload.trygestionContactoId) throw new Skipped('CONTACT_NEVER_SYNCED');
    try { await client.eliminarContacto(payload.trygestionContactoId, key); } catch (error) {
      if (error instanceof TrygestionError && error.status === 404) return; // ya no estaba en trygestión
      throw error;
    }
    return;
  }
  const contact = job.kind === 'CONTACT_UPSERT' ? await db.contact.findUnique({ where: { id: job.entityId } }) : null;
  const activity = ['ACTIVITY', 'EVENT'].includes(job.kind) ? await db.activity.findUnique({ where: { id: job.entityId } }) : null;
  if (job.kind === 'CONTACT_UPSERT' && !contact || ['ACTIVITY', 'EVENT'].includes(job.kind) && !activity) throw new Skipped('LOCAL_ENTITY_DELETED');
  const company = await dependency(db, payload.companyId ?? contact?.companyId ?? activity?.companyId ?? job.entityId);
  if (job.kind === 'CONTACT_UPSERT' && contact) {
    if (contact.trygestionContactoId) return;
    const data = { empresa_id: company.trygestionEmpresaId!, nombre: contact.fullName, cargo: contact.role, telefono: contact.phone, email: contact.email };
    const found = await client.buscarContacto(data) ?? await client.crearContacto(data, key);
    await db.contact.update({ where: { id: contact.id }, data: { trygestionContactoId: found.id } }); return;
  }
  if (job.kind === 'OPPORTUNITY_STAGE') { await client.cambiarEtapa(company.trygestionOportunidadId!, await stageId(client, payload.stage ?? company.pipelineStage), key); return; }
  if (job.kind === 'OPPORTUNITY_STATUS') { await client.cambiarEstado(company.trygestionOportunidadId!, payload.estado ?? 'perdida', payload.motivo, key); return; }
  if (job.kind === 'ACTIVITY' && activity) {
    if (activity.trygestionActividadId) return;
    if (activity.type === 'EMAIL' && activity.taskId) {
      const delivery = await db.emailDispatch.findUnique({ where: { taskId: activity.taskId } });
      if (delivery?.status === 'SENT' && delivery.opportunityId) throw new Skipped('EMAIL_ALREADY_RECORDED_REMOTE');
    }
    const type = { CALL: 'llamada', EMAIL: 'email', NOTE: 'nota', MEETING: 'reunion' }[activity.type] as 'llamada' | 'email' | 'nota' | 'reunion';
    const author = activity.authorId ? await db.user.findUnique({ where: { id: activity.authorId }, select: { name: true, email: true } }) : null;
    const signature = author ? `Registrado por ${author.name || author.email} en try! Comercial.` : 'Registrado en try! Comercial.';
    const descripcion = [activity.body ?? activity.result ?? '', signature].filter(Boolean).join('\n');
    const result = await client.crearActividad(company.trygestionOportunidadId!, { tipo: type, titulo: activity.result ?? 'Actividad comercial', descripcion, fecha_programada: activity.createdAt.toISOString() }, key);
    await db.activity.update({ where: { id: activity.id }, data: { trygestionActividadId: result.id } }); return;
  }
  if (job.kind === 'EVENT' && activity) {
    if (activity.trygestionEventoId) return;
    const parsed = eventSchema.safeParse(payload.event); if (!parsed.success) throw new TrygestionError('MEETING_DATE_REQUIRED');
    const organizer = activity.authorId ? await db.user.findUnique({ where: { id: activity.authorId }, select: { name: true, email: true } }) : null;
    if (organizer) parsed.data.descripcion = [parsed.data.descripcion, `Agendada por ${organizer.name || organizer.email} desde try! Comercial.`].filter(Boolean).join('\n');
    const result = await client.crearEvento(parsed.data as EventoInput, key);
    await db.activity.update({ where: { id: activity.id }, data: { trygestionEventoId: result.id } });
  }
}

export async function processSyncOutbox(db: PrismaClient, options: { client?: TrygestionClient; limit?: number; companyId?: string; now?: Date } = {}) {
  const client = options.client ?? new TrygestionClient();
  const summary = { disabled: !client.enabled, locked: false, done: 0, failed: 0, deferred: 0, skipped: 0 };
  if (!client.enabled) return summary;
  return db.$transaction(async lock => {
    const [row] = await lock.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(48106) AS acquired`;
    if (!row.acquired) return { ...summary, locked: true };
    await db.syncOutbox.updateMany({ where: { status: 'PROCESSING' }, data: { status: 'PENDING', lastError: 'RECOVERED_INCOMPLETE' } });
    const now = options.now ?? new Date();
    const jobs = await db.syncOutbox.findMany({ where: { status: 'PENDING', nextAttemptAt: { lte: now }, ...(options.companyId ? { OR: [{ entityId: options.companyId }, { payload: { path: ['companyId'], equals: options.companyId } }] } : {}) }, orderBy: { createdAt: 'asc' }, take: Math.max(1, Math.min(100, options.limit ?? 20)) });
    const started = Date.now();
    for (const job of jobs) {
      if (Date.now() - started > 45_000) break;
      if (job.attempts >= 8) { await db.syncOutbox.update({ where: { id: job.id }, data: { status: 'FAILED', lastError: 'MAX_ATTEMPTS' } }); summary.failed++; continue; }
      await db.syncOutbox.update({ where: { id: job.id }, data: { status: 'PROCESSING', attempts: { increment: 1 } } });
      try {
        await perform(db, job, client);
        await db.syncOutbox.update({ where: { id: job.id }, data: { status: 'DONE', lastError: null } }); summary.done++;
      } catch (error) {
        if (error instanceof Deferred) {
          await db.syncOutbox.update({ where: { id: job.id }, data: { status: 'PENDING', attempts: { decrement: 1 }, nextAttemptAt: new Date(now.getTime() + 60_000), lastError: error.message } }); summary.deferred++; continue;
        }
        if (error instanceof Skipped) { await db.syncOutbox.update({ where: { id: job.id }, data: { status: 'SKIPPED', lastError: error.message } }); summary.skipped++; continue; }
        const message = error instanceof TrygestionError ? error.code : 'SYNC_PROCESSING_ERROR';
        const permanent = /^(STAGE_|INVALID_STAGE|MEETING_DATE|AMBIGUOUS_|UNAUTHORIZED|REMOTE_COMPANY_ALREADY_LINKED)/.test(message) || error instanceof TrygestionError && [400, 403, 404, 422].includes(error.status);
        const terminal = permanent || job.attempts + 1 >= 8;
        await db.syncOutbox.update({ where: { id: job.id }, data: { status: terminal ? 'FAILED' : 'PENDING', nextAttemptAt: new Date(now.getTime() + backoffMs(job.attempts + 1)), lastError: message } });
        if (terminal) summary.failed++;
      }
    }
    return summary;
  }, { maxWait: 1000, timeout: 300_000 });
}
export async function retryFailed(db: PrismaClient) { return db.syncOutbox.updateMany({ where: { status: 'FAILED' }, data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null } }); }
