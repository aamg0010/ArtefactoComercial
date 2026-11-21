import { readFile } from 'node:fs/promises';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { generateJson } from '../llm';
import { madridDate } from '../dates';
import { isSuppressed } from '../suppression';
import { crawlCompanyWebsite } from './crawler';
import { mockResearch, researchInstructions, researchSchema, researchShape } from './schema';
import { calculateScore, defaultWeights } from './scoring';
import { generatedScriptSchema, generatedScriptShape, mockScript, type StandardStep } from './scripts';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export async function investigateCompany(db: PrismaClient, companyId: string) {
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId }, include: { contacts: true, opportunities: { include: { product: true } } } });
  const catalog = await db.product.findMany({ where: { active: true } });
  const preferred = [...new Set([...company.opportunities.map(item => item.product.line), ...catalog.map(item => item.line)])];
  const web = await crawlCompanyWebsite(company.website ?? company.normalizedDomain);
  const sources = [{ id: 'crm', url: `urn:try-comercial:company:${company.id}`, date: new Date().toISOString(), text: [company.name, company.sector, company.employeeRange, company.city, company.comarca, company.region].filter(Boolean).join(' · ') }, ...web.sources];
  const example = mockResearch(sources, company.sector, preferred, web.note);
  const report = await generateJson({
    system: researchInstructions,
    prompt: JSON.stringify({ tarea: 'Investigación comercial con fuentes', sources, catalogo: catalog.map(item => item.line), webNote: web.note, formatoJSON: { ...example, sources: sources.map(source => ({ id: source.id, url: source.url, date: source.date })) } }),
    schema: researchSchema(sources, catalog.map(item => item.line)),
  }, { db, companyId, purpose: 'research', mockResponse: example });
  const weights = await db.scoringWeights.findUnique({ where: { id: 'default' } }) ?? defaultWeights;
  const score = calculateScore(report, { comarca: company.comarca, hasContact: Boolean(company.email || company.phone || company.contacts.some(contact => contact.email || contact.phone)) }, weights);
  return db.$transaction(async tx => {
    const latest = await tx.researchReport.aggregate({ where: { companyId }, _max: { version: true } });
    return tx.researchReport.create({ data: { companyId, version: (latest._max.version ?? 0) + 1, origin: 'AI', summary: report.summary.text, data: json(report), score: { create: { companyId, ...score, breakdown: json(score.breakdown) } } }, include: { score: true } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function applySuggestedPriority(db: PrismaClient, companyId: string, userId: string) {
  const score = await db.score.findFirstOrThrow({ where: { companyId }, orderBy: { createdAt: 'desc' } });
  await db.$transaction([
    db.company.update({ where: { id: companyId }, data: { priority: score.suggestedPriority } }),
    db.auditLog.create({ data: { userId, entityType: 'Company', entityId: companyId, action: 'APPLY_SUGGESTED_PRIORITY', metadata: { scoreId: score.id, priority: score.suggestedPriority } } }),
  ]);
}

export async function generateCompanyScript(db: PrismaClient, companyId: string, requestedProduct?: string) {
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  const report = await db.researchReport.findFirstOrThrow({ where: { companyId, origin: 'AI' }, orderBy: { version: 'desc' } });
  const research = researchShape.parse(report.data);
  const product = await db.product.findUniqueOrThrow({ where: { line: requestedProduct || research.recommendations[0].line } });
  const templates = await db.template.findMany({ orderBy: { name: 'asc' } });
  if (templates.length === 0) throw new Error('Ejecuta el seed para cargar las plantillas.');
  const file = JSON.parse(await readFile('data/guiones.json', 'utf8')) as { cadencia_estandar: StandardStep[] };
  const example = mockScript(company.name, product.line, research, file.cadencia_estandar);
  const script = await generateJson({
    system: `${researchInstructions}\nGenera un guion comercial BORRADOR en español adaptado al país y rol. Usa las cinco plantillas sólo como estructura, nunca copies sus nombres, cifras, contactos o hechos de otras empresas. El cliente compra productividad, rentabilidad, menos riesgo y capacidad de decisión. No afirmes hipótesis como hechos. Usa exactamente la cadencia estándar. Cada email incluye try! company, motivo, BAJA, [TELÉFONO] y [WEB]. No insertes URLs o emails.`,
    prompt: JSON.stringify({ pais: company.country, empresa: company.name, ficha: research, producto: product.line, plantillas: templates.map(item => item.content), cadencia: file.cadencia_estandar, formatoJSON: example }),
    schema: generatedScriptSchema(research.sources, product.line, file.cadencia_estandar),
  }, { db, companyId, purpose: 'script', mockResponse: example });
  return db.$transaction(async tx => {
    const latest = await tx.script.aggregate({ where: { companyId }, _max: { version: true } });
    return tx.script.create({ data: { companyId, version: (latest._max.version ?? 0) + 1, author: 'IA', status: 'BORRADOR', content: json(script) } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function approveCompanyScript(db: PrismaClient, scriptId: string, userId?: string) {
  return db.$transaction(async tx => {
    const script = await tx.script.findUniqueOrThrow({ where: { id: scriptId }, include: { company: true } });
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
