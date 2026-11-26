import { companyScriptContext, scriptPrompt } from './script-context';
import { isReusableDraft } from './scripts';
import { enqueueCompany } from '../trygestion/outbox';
import { readFile } from 'node:fs/promises';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { generateJson } from '../llm';
import { madridDate } from '../dates';
import { isSuppressed } from '../suppression';
import { hasDirectContact } from '../company-contact';
import { crawlCompanyWebsite } from './crawler';
import { mockResearch, researchInstructions, researchSchema, researchShape } from './schema';
import { calculateScore, defaultWeights } from './scoring';
import { generatedScriptSchema, generatedScriptShape, mockScript, scriptSkeleton, type StandardStep } from './scripts';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export async function investigateCompany(db: PrismaClient, companyId: string, signal?: AbortSignal) {
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId }, include: { contacts: true, opportunities: { include: { product: true } } } });
  if (company.acceptanceStatus !== 'ACCEPTED') throw new Error('Acepta la empresa antes de investigarla.');
  const catalog = await db.product.findMany({ where: { active: true } });
  const preferred = [...new Set([...company.opportunities.map(item => item.product.line), ...catalog.map(item => item.line)])];
  const web = await crawlCompanyWebsite(company.website ?? company.normalizedDomain);
  const sources = [{ id: 'crm', url: `urn:try-comercial:company:${company.id}`, date: new Date().toISOString(), text: [company.name, company.sector, company.employeeRange, company.city, company.comarca, company.region].filter(Boolean).join(' · ') }, ...web.sources];
  const example = mockResearch(sources, company.sector, preferred, web.note);
  const report = await generateJson({
    system: researchInstructions,
    prompt: JSON.stringify({ tarea: 'Investigación comercial con fuentes', sources, catalogo: catalog.map(item => ({ linea: item.line, queOfrece: item.description })), webNote: web.note, formatoJSON: { ...example, sources: sources.map(source => ({ id: source.id, url: source.url, date: source.date })) } }),
    schema: researchSchema(sources, catalog.map(item => item.line)),
  }, { db, companyId, signal, purpose: 'research', mockResponse: example });
  const weights = await db.scoringWeights.findUnique({ where: { id: 'default' } }) ?? defaultWeights;
  const score = calculateScore(report, { comarca: company.comarca, hasContact: hasDirectContact(company) || company.contacts.some(hasDirectContact) }, weights);
  signal?.throwIfAborted();
  return db.$transaction(async tx => {
    signal?.throwIfAborted();
    const latest = await tx.researchReport.aggregate({ where: { companyId }, _max: { version: true } });
    await tx.company.update({ where: { id: companyId }, data: { researchQueuedAt: null } });
    signal?.throwIfAborted();
    const saved = await tx.researchReport.create({ data: { companyId, version: (latest._max.version ?? 0) + 1, origin: 'AI', summary: report.summary.text, data: json(report), score: { create: { companyId, ...score, breakdown: json(score.breakdown) } } }, include: { score: true } });
    await enqueueCompany(tx, companyId, saved.score?.id);
    signal?.throwIfAborted();
    return saved;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function applySuggestedPriority(db: PrismaClient, companyId: string, userId: string) {
  const score = await db.score.findFirstOrThrow({ where: { companyId }, orderBy: { createdAt: 'desc' } });
  await db.$transaction(async tx => {
    await tx.company.update({ where: { id: companyId }, data: { priority: score.suggestedPriority } });
    await tx.auditLog.create({ data: { userId, entityType: 'Company', entityId: companyId, action: 'APPLY_SUGGESTED_PRIORITY', metadata: { scoreId: score.id, priority: score.suggestedPriority } } });
    await enqueueCompany(tx, companyId, score.id);
  });
}

export async function generateCompanyScript(db: PrismaClient, companyId: string, requestedProduct?: string, signal?: AbortSignal) {
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId }, include: { evidence: true, contacts: true, activities: { where: { type: { in: ['CALL', 'MEETING', 'NOTE'] } }, orderBy: { createdAt: 'desc' }, take: 5 } } });
  const latestScript = await db.script.findFirst({ where: { companyId }, orderBy: { version: 'desc' } });
  // Solo se reutiliza el borrador vigente con el marco actual; los borradores antiguos quedan como historial.
  const existingDraft = latestScript && isReusableDraft(latestScript) ? latestScript : null;
  if (company.acceptanceStatus !== 'ACCEPTED') throw new Error('La empresa está pendiente de aceptar o descartada.');
  if (existingDraft) return existingDraft;
  const report = await db.researchReport.findFirstOrThrow({ where: { companyId, origin: 'AI' }, orderBy: { version: 'desc' } });
  const research = researchShape.parse(report.data);
  const product = await db.product.findUniqueOrThrow({ where: { line: requestedProduct || research.recommendations[0].line } });
  const templates = await db.template.findMany({ orderBy: { name: 'asc' } });
  if (templates.length === 0) throw new Error('Ejecuta el seed para cargar las plantillas.');
  const file = JSON.parse(await readFile('data/guiones.json', 'utf8')) as { cadencia_estandar: StandardStep[] };
  const context = companyScriptContext(company, research);
  const enriched = { ...research, sources: context.evidence };
  const example = mockScript(company.name, product.line, enriched, file.cadencia_estandar);
  const input = scriptPrompt(context, research, product, templates.map(item => item.content), file.cadencia_estandar, example);
  const script = await generateJson({ ...input,
    schema: generatedScriptSchema(context.evidence, product.line, file.cadencia_estandar, [...context.allowedNames, product.line], { companyName: company.name, personNames: context.personNames, companyEvidence: context.evidence.filter(e => !e.id.startsWith('activity-')) }),
  }, { db, companyId, signal, purpose: 'script', mockResponse: example });
  signal?.throwIfAborted();
  return db.$transaction(async tx => {
    signal?.throwIfAborted();
    const latest = await tx.script.aggregate({ where: { companyId }, _max: { version: true } });
    signal?.throwIfAborted();
    const saved = await tx.script.create({ data: { companyId, version: (latest._max.version ?? 0) + 1, author: 'IA', status: 'BORRADOR', content: json(script) } });
    signal?.throwIfAborted();
    return saved;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function approveCompanyScript(db: PrismaClient, scriptId: string, userId?: string) {
  return db.$transaction(async tx => {
    const script = await tx.script.findUniqueOrThrow({ where: { id: scriptId }, include: { company: true } });
    if (script.company.acceptanceStatus !== 'ACCEPTED') throw new Error('La empresa está pendiente de aceptar o descartada.');
    if (script.status === 'APPROVED') return;
    const newer = await tx.script.count({ where: { companyId: script.companyId, version: { gt: script.version } } });
    if (newer) throw new Error('Aprueba únicamente la versión más reciente.');
    const content = generatedScriptShape.parse(script.content);
    const changed = await tx.script.updateMany({ where: { id: script.id, status: 'BORRADOR' }, data: { status: 'APPROVED', approvedAt: new Date(), approvedBy: userId } });
    if (!changed.count) return;
    const suppressed = await isSuppressed(tx, script.companyId);
    const cadence = await tx.cadence.create({ data: { name: `IA ${script.id}` } });
    const startDate = script.company.nextActionAt ?? new Date(`${madridDate()}T00:00:00.000Z`);
    const companyCadence = await tx.companyCadence.create({ data: { companyId: script.companyId, cadenceId: cadence.id, scriptId, startDate, status: suppressed ? 'PAUSED' : 'ACTIVE' } });
    for (const step of content.cadencia) {
      const type = step.canal === 'email' ? 'EMAIL' : 'CALL';
      const cadenceStep = await tx.cadenceStep.create({ data: { cadenceId: cadence.id, dayOffset: step.dia, type, action: step.accion } });
      if (!suppressed) await tx.task.create({ data: { companyId: script.companyId, companyCadenceId: companyCadence.id, cadenceStepId: cadenceStep.id, scriptId, assigneeId: userId ?? script.company.ownerId, type, title: step.accion, dueAt: new Date(startDate.getTime() + (step.dia - 1) * 86_400_000) } });
    }
    await tx.auditLog.create({ data: { userId, entityType: 'Script', entityId: scriptId, action: 'APPROVE_SCRIPT', metadata: { suppressed, companyCadenceId: companyCadence.id } } });
  });
}

/** Confirmación separada de la generación: conserva las tareas, fechas y cadencias existentes. */
export async function updatePendingScriptEmails(db: PrismaClient, companyId: string, scriptId: string, userId: string) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId} FOR UPDATE`;
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    if (company.acceptanceStatus !== 'ACCEPTED' || await isSuppressed(tx, companyId)) throw new Error('Empresa no disponible.');
    const script = await tx.script.findFirstOrThrow({ where: { id: scriptId, companyId, status: 'BORRADOR' } });
    const latest = await tx.script.findFirstOrThrow({ where: { companyId }, orderBy: { version: 'desc' } });
    if (latest.id !== script.id) throw new Error('Revisa la versión más reciente.');
    const content = generatedScriptShape.parse(script.content);
    const tasks = await tx.task.findMany({ where: { companyId, type: 'EMAIL', status: 'PENDING', script: { status: 'APPROVED' } }, include: { cadenceStep: true, script: true } });
    const changed: { taskId: string; previousScriptId: string | null; emailIndex: number }[] = [];
    for (const task of tasks.sort((a, b) => a.id.localeCompare(b.id))) {
      // Mismo cerrojo que el envío: no se cambia un intento en curso, fallido o ya enviado.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`email:${task.id}`}))`;
      if (await tx.emailDispatch.findUnique({ where: { taskId: task.id } })) continue;
      const old = generatedScriptShape.safeParse(task.script?.content);
      const day = task.scriptEmailIndex !== null ? (old.success ? old.data.emails[task.scriptEmailIndex]?.dia : undefined) : task.cadenceStep?.dayOffset;
      const index = content.emails.findIndex(e => e.dia === day);
      if (index < 0) continue;
      const updated = await tx.task.updateMany({ where: { id: task.id, status: 'PENDING', scriptId: task.scriptId }, data: { scriptId, scriptEmailIndex: index } });
      if (updated.count) changed.push({ taskId: task.id, previousScriptId: task.scriptId, emailIndex: index });
    }
    if (!changed.length) throw new Error('No quedan emails pendientes sin intento de envío compatibles.');
    await tx.script.update({ where: { id: scriptId }, data: { status: 'APPROVED', approvedAt: new Date(), approvedBy: userId } });
    await tx.auditLog.create({ data: { userId, entityType: 'Script', entityId: scriptId, action: 'UPDATE_PENDING_EMAIL_TEXTS', metadata: { companyId, tasks: changed } } });
    return changed.length;
  });
}
