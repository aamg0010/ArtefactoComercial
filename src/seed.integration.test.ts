import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { investigateCompany, generateCompanyScript, approveCompanyScript, applySuggestedPriority } from './lib/research/service';
import { setCompanyCadenceStatus } from './lib/cadence';
import { isSafeTestDatabase } from './lib/test-database';
import { completeTask } from './lib/tasks';
import prospects from '../data/prospectos.json';
import { runProspecting } from './lib/prospecting/service';
import { sourceAdapter } from './lib/sources';
import type { CandidateCompany, SourceAdapter } from './lib/sources/types';

const run = promisify(execFile);
const url = process.env.TEST_DATABASE_URL;
const enabled = isSafeTestDatabase(url, process.env.DATABASE_URL);
// An unsafe URL never reaches Prisma or a seed subprocess, including skipped hooks.
const prisma = enabled ? new PrismaClient({ datasources: { db: { url } } }) : undefined;
const env = { ...process.env, DATABASE_URL: url, SEED_ADMIN_PASSWORD: 'integration-admin', SEED_SALES_PASSWORD: 'integration-sales' };
// Use TypeScript's CJS transform for subprocesses: the tsx CLI calls os.userInfo(),
// which is unavailable in restricted Windows sessions. Execute the same source.
const typescriptRunner = `
  const fs = require('node:fs');
  const ts = require('typescript');
  require.extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    });
    module._compile(outputText, filename);
  };
  process.argv = [process.execPath, ...process.argv.slice(1)];
  require(require('node:path').resolve(process.argv[1]));
`;
const runTypescript = (file: string, args: string[] = []) =>
  run(process.execPath, ['-e', typescriptRunner, file, ...args], { env });
const seed = () => runTypescript('prisma/seed-real.ts');

describe.runIf(enabled)('integración sobre base aislada', () => {
  const db = prisma!;
  const cadenceIds: string[] = [];
  const taskIds: string[] = [];
  const companyIds: string[] = [];
  const profileIds: string[] = [];
  let tempDirectory: string;
  let caspeStage: string;

  beforeAll(async () => {
    vi.stubEnv('LLM_PROVIDER', 'mock');
    vi.stubEnv('GOOGLE_PLACES_API_KEY', '');
    // This suite owns only the explicitly validated disposable database.
    await db.company.deleteMany();
    await db.companySource.deleteMany();
    await db.sourceRun.deleteMany();
    await db.searchProfile.deleteMany();
    await db.cadence.deleteMany();
    await db.suppressionList.deleteMany();
    await seed();
    tempDirectory = await mkdtemp(join(process.cwd(), '.integration-test-'));
    caspeStage = (await db.company.findUniqueOrThrow({ where: { sourceId: 'cooperativa-ganadera-de-caspe' } })).pipelineStage;
  }, 60_000);

  afterEach(async () => {
    if (profileIds.length) {
      await db.company.deleteMany({ where: { discoveryRun: { profileId: { in: profileIds } } } });
      await db.searchProfile.deleteMany({ where: { id: { in: profileIds.splice(0) } } });
      await db.companySource.deleteMany();
      await db.suppressionList.deleteMany({ where: { reason: 'prospecting-test' } });
    }
    await db.task.deleteMany({ where: { id: { in: taskIds.splice(0) } } });
    await db.companyCadence.deleteMany({ where: { cadenceId: { in: cadenceIds } } });
    await db.cadence.deleteMany({ where: { id: { in: cadenceIds.splice(0) } } });
    await db.company.deleteMany({ where: { id: { in: companyIds.splice(0) } } });
    const caspe = await db.company.findUniqueOrThrow({ where: { sourceId: 'cooperativa-ganadera-de-caspe' } });
    await db.suppressionList.deleteMany({ where: { companyId: caspe.id } });
    await db.company.update({ where: { id: caspe.id }, data: { pipelineStage: caspeStage } });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await db.$disconnect();
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
  });

  // Clone Caspe's actual seeded cadence, preserving its script and real steps.
  // Each test owns a unique cadence; none exist during the initial 79-task count.
  async function caspeTask() {
    const company = await db.company.findUniqueOrThrow({ where: { sourceId: 'cooperativa-ganadera-de-caspe' } });
    const original = await db.companyCadence.findFirstOrThrow({
      where: { companyId: company.id, cadence: { name: 'Seed cooperativa-ganadera-de-caspe' } },
      include: { cadence: { include: { steps: { orderBy: { dayOffset: 'asc' } } } } },
    });
    const cadence = await db.cadence.create({
      data: { name: `test-caspe-${randomUUID()}`, steps: { create: original.cadence.steps.map(({ dayOffset, type, action }) => ({ dayOffset, type, action })) } },
      include: { steps: { orderBy: { dayOffset: 'asc' } } },
    });
    cadenceIds.push(cadence.id);
    const cc = await db.companyCadence.create({
      data: { companyId: company.id, cadenceId: cadence.id, scriptId: original.scriptId, startDate: original.startDate },
    });
    const first = cadence.steps.find(step => step.type === 'CALL')!;
    const next = cadence.steps.find(step => step.dayOffset > first.dayOffset)!;
    // Leave the second step absent so the result must actually generate it.
    for (const step of cadence.steps.filter(step => step.id !== next.id)) {
      await db.task.create({ data: {
        companyId: company.id, companyCadenceId: cc.id, cadenceStepId: step.id,
        scriptId: original.scriptId, type: step.type, title: step.action,
        dueAt: new Date(original.startDate.getTime() + (step.dayOffset - 1) * 86_400_000),
      } });
    }
    const task = await db.task.findUniqueOrThrow({ where: { companyId_cadenceStepId: { companyId: company.id, cadenceStepId: first.id } } });
    return { company, cc, task, next };
  }

  it('el seed limpio genera 79 tareas con la distribución y fechas esperadas', async () => {
    const tasks = await db.task.findMany({ include: { company: true, companyCadence: { include: { cadence: true } } } });
    const expected: Record<string, number> = {
      'la-calandina-s-coop': 6, 'cooperativa-ganadera-de-caspe': 6,
      'la-chipranesca-s-c-l': 6, 'pastores-grupo-cooperativo': 6, 'aceites-impelte': 4,
    };
    const groups = Object.values(tasks.reduce<Record<string, { company: string; cadence: string; count: number }>>((all, task) => {
      const key = `${task.companyId}/${task.companyCadence?.cadence.name ?? 'sin cadencia'}`;
      all[key] ??= { company: task.company.sourceId!, cadence: task.companyCadence?.cadence.name ?? 'sin cadencia', count: 0 };
      all[key].count++;
      return all;
    }, {}));
    if (tasks.length !== 79) console.table(groups);
    expect(tasks).toHaveLength(79);
    expect(groups).toHaveLength(56);
    for (const group of groups) expect(group.count, `${group.company}: ${group.cadence}`).toBe(expected[group.company] ?? 1);
    const dated = tasks.filter(task => task.dueAt?.toISOString() === '2026-11-23T00:00:00.000Z');
    expect(dated.map(task => task.company.sourceId)).toEqual(expect.arrayContaining(['la-calandina-s-coop', 'cooperativa-ganadera-de-caspe']));
    expect(await db.company.count()).toBe(56);
    expect(await db.script.count()).toBe(5);
    expect(await db.opportunity.count()).toBe(121);
    expect(await db.searchProfile.count({ where: { active: false } })).toBe(3);
  });

  it('el seed extrae las seis webs y no verifica contactos que sólo tienen web', async () => {
    for (const [sourceId, domain] of [
      ['limabril-s-l', 'limabril.com'], ['cooperativa-ganadera-de-caspe', 'ganaderacaspe.com'],
      ['pastores-grupo-cooperativo', 'grupopastores.coop'], ['grupo-arcoiris', 'grupoarcoiris.com'],
      ['venta-d-aubert', 'ventadaubert.com'], ['la-calandina-s-coop', 'lacalandina.com'],
    ]) {
      expect(await db.company.findUniqueOrThrow({ where: { sourceId } })).toMatchObject({ website: `https://${domain}`, normalizedDomain: domain });
    }
    for (const sourceId of ['limabril-s-l', 'pastores-grupo-cooperativo']) {
      expect(await db.contact.findUniqueOrThrow({ where: { id: `contact-${sourceId}` } })).toMatchObject({ email: null, phone: null, verified: false });
    }
  });

  it('import:sheet extrae webs y conserva una web ya informada', async () => {
    const cases = [
      ['limabril-s-l', 'limabril.com'], ['cooperativa-ganadera-de-caspe', 'ganaderacaspe.com'],
      ['pastores-grupo-cooperativo', 'grupopastores.coop'], ['grupo-arcoiris', 'grupoarcoiris.com'],
      ['venta-d-aubert', 'ventadaubert.com'], ['la-calandina-s-coop', 'lacalandina.com'],
    ];
    const rows: string[][] = [['id', 'empresa', 'contacto_corporativo']];
    for (const [id] of cases) {
      const original = prospects.find(item => item.id === id)!;
      const company = await db.company.create({ data: { sourceId: `web-test-${id}`, name: `Prueba ${original.empresa}`, normalizedName: randomUUID(), country: 'ES' } });
      companyIds.push(company.id);
      rows.push([company.sourceId!, company.name, original.contacto.texto]);
    }
    const existing = await db.company.create({ data: { sourceId: 'web-test-existing', name: 'Web existente', normalizedName: randomUUID(), country: 'ES', website: 'https://elegida.example.test', normalizedDomain: 'elegida.example.test' } });
    companyIds.push(existing.id); rows.push([existing.sourceId!, existing.name, 'sustituta.example.test']);
    const file = join(tempDirectory, 'webs.csv');
    await writeFile(file, rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\n'));
    await runTypescript('scripts/import-sheet.ts', [file]);
    for (const [id, domain] of cases) {
      const company = await db.company.findUniqueOrThrow({ where: { sourceId: `web-test-${id}` }, include: { contacts: true } });
      expect(company).toMatchObject({ website: `https://${domain}`, normalizedDomain: domain });
      if (id === 'limabril-s-l' || id === 'pastores-grupo-cooperativo') expect(company.contacts[0]).toMatchObject({ email: null, phone: null, verified: false });
    }
    expect(await db.company.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({ website: 'https://elegida.example.test', normalizedDomain: 'elegida.example.test' });
  }, 30_000);

  it('import:sheet casa el municipio sin acentos ni mayúsculas tras permitir homónimas', async () => {
    const company = await db.company.create({ data: { name: 'Importación homónima', normalizedName: 'importacion homonima', country: 'ES', city: 'Alcañiz' } });
    const other = await db.company.create({ data: { name: 'Importación homónima', normalizedName: 'importacion homonima', country: 'ES', city: 'Caspe' } });
    companyIds.push(company.id, other.id);
    const file = join(tempDirectory, 'city.csv');
    await writeFile(file, 'empresa,municipio,estado\nImportacion homonima,ALCANIZ,Contactado\n');
    await runTypescript('scripts/import-sheet.ts', [file]);
    expect((await db.company.findUniqueOrThrow({ where: { id: company.id } })).pipelineStage).toBe('CONTACTING');
    expect((await db.company.findUniqueOrThrow({ where: { id: other.id } })).pipelineStage).toBe('DETECTED');
    expect(await db.company.count({ where: { normalizedName: 'importacion homonima' } })).toBe(2);
  }, 30_000);

  it('importa un cambio de estado desde CSV con id', async () => {
    const file = join(tempDirectory, 'state.csv');
    await writeFile(file, 'id,empresa,estado,prioridad,provincia,municipio,comarca,sector,contacto_corporativo,proxima_accion,fecha_proxima_accion\nla-calandina-s-coop,La Calandina S. Coop.,Contactado,A,Teruel,Calanda,Bajo Aragón,Cooperativa,info@lacalandina.com,Llamar,2026-12-01\n');
    await runTypescript('scripts/import-sheet.ts', [file]);
    expect(await db.company.findUniqueOrThrow({ where: { sourceId: 'la-calandina-s-coop' } })).toMatchObject({ pipelineStage: 'CONTACTING', priority: 'A', nextAction: 'Llamar', nextActionAt: new Date('2026-12-01T00:00:00Z') });
  }, 30_000);

  it('importa la hoja compartida sin id, con cabeceras acentuadas y fecha dd/mm/aaaa', async () => {
    const company = await db.company.findUniqueOrThrow({ where: { sourceId: 'la-calandina-s-coop' } });
    const file = join(tempDirectory, 'sheet.csv');
    await writeFile(file, 'Prioridad,Empresa,Municipio,Comarca,Provincia,Sector,Encaje try!,Ángulo de entrada,Contacto corporativo,Estado,Próxima acción,Fecha,Fuente\nB,LA CALANDINA S COOP,Calanda,Bajo Aragón,Teruel,Agro,Ganadex,Entrada,info@lacalandina.com verificar,Reunión agendada,Trabajo comercial,01/12/2026,Hoja\n');
    await runTypescript('scripts/import-sheet.ts', [file]);
    expect(await db.company.findUniqueOrThrow({ where: { id: company.id } })).toMatchObject({ priority: 'B', pipelineStage: 'MEETING', comarca: 'Bajo Aragón', region: 'Teruel', city: 'Calanda', sector: 'Agro', nextAction: 'Trabajo comercial', nextActionAt: new Date('2026-12-01T00:00:00Z') });
    expect(await db.company.count()).toBe(56);
    expect(await db.contact.findFirstOrThrow({ where: { companyId: company.id, fullName: 'Contacto general' } })).toMatchObject({ email: 'info@lacalandina.com', verified: false });
  }, 30_000);

  it('el seed doble conserva el número de tareas y el estado comercial importado', async () => {
    const count = await db.task.count();
    await db.company.update({ where: { sourceId: 'la-calandina-s-coop' }, data: { website: 'https://web-informada.example.test' } });
    await seed();
    expect(await db.task.count()).toBe(count);
    expect(await db.company.findUniqueOrThrow({ where: { sourceId: 'la-calandina-s-coop' } })).toMatchObject({ pipelineStage: 'MEETING', priority: 'B', nextAction: 'Trabajo comercial', nextActionAt: new Date('2026-12-01T00:00:00Z') });
    expect(await db.company.count()).toBe(56);
    expect(await db.script.count()).toBe(5);
    expect(await db.opportunity.count()).toBe(121);
    expect((await db.company.findUniqueOrThrow({ where: { sourceId: 'la-calandina-s-coop' } })).website).toBe('https://web-informada.example.test');
  }, 60_000);

  it.each(['No contesta', 'Buzón', 'Contactado'])('%s genera el siguiente paso real de Caspe y mantiene ACTIVE', async result => {
    const { company, cc, task, next } = await caspeTask();
    await completeTask(db, task.id, result);
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: 'COMPLETED', result });
    expect(await db.activity.count({ where: { taskId: task.id, result, type: 'CALL' } })).toBe(1);
    expect((await db.companyCadence.findUniqueOrThrow({ where: { id: cc.id } })).status).toBe('ACTIVE');
    expect(await db.task.findUniqueOrThrow({ where: { companyId_cadenceStepId: { companyId: company.id, cadenceStepId: next.id } } })).toMatchObject({ status: 'PENDING', companyCadenceId: cc.id });
    if (result === 'Contactado') expect((await db.company.findUniqueOrThrow({ where: { id: company.id } })).pipelineStage).toBe('CONTACTING');
  });

  it.each(['Interesado', 'Reunión agendada'])('%s pausa la cadencia real de Caspe y cancela todas sus pendientes', async result => {
    const { company, cc, task } = await caspeTask();
    await completeTask(db, task.id, result);
    expect((await db.companyCadence.findUniqueOrThrow({ where: { id: cc.id } })).status).toBe('PAUSED');
    expect(await db.task.count({ where: { companyCadenceId: cc.id, status: 'PENDING' } })).toBe(0);
    expect(await db.activity.count({ where: { taskId: task.id, result } })).toBe(1);
    expect((await db.company.findUniqueOrThrow({ where: { id: company.id } })).pipelineStage).toBe(result === 'Reunión agendada' ? 'MEETING' : 'CONTACTING');
  });

  it('No interesado finaliza la cadencia de Caspe y deja la empresa LOST', async () => {
    const { company, cc, task } = await caspeTask();
    await completeTask(db, task.id, 'No interesado');
    expect((await db.companyCadence.findUniqueOrThrow({ where: { id: cc.id } })).status).toBe('FINISHED');
    expect(await db.task.count({ where: { companyCadenceId: cc.id, status: 'PENDING' } })).toBe(0);
    expect((await db.company.findUniqueOrThrow({ where: { id: company.id } })).pipelineStage).toBe('LOST');
    expect(await db.activity.count({ where: { taskId: task.id, result: 'No interesado' } })).toBe(1);
  });

  it('Baja suprime Caspe y cancela sus tareas con y sin cadencia', async () => {
    const { company, cc, task } = await caspeTask();
    const standalone = await db.task.create({ data: { companyId: company.id, type: 'FOLLOW_UP', title: 'Sin cadencia' } });
    taskIds.push(standalone.id);
    await completeTask(db, task.id, 'Baja');
    expect(await db.suppressionList.findFirst({ where: { companyId: company.id } })).not.toBeNull();
    expect(await db.task.count({ where: { companyId: company.id, status: 'PENDING' } })).toBe(0);
    expect((await db.task.findUniqueOrThrow({ where: { id: standalone.id } })).status).toBe('CANCELLED');
    expect((await db.companyCadence.findUniqueOrThrow({ where: { id: cc.id } })).status).toBe('PAUSED');
    expect(await db.activity.count({ where: { taskId: task.id, result: 'Baja' } })).toBe(1);
  });

  it('rechaza el doble clic y registra una sola Activity', async () => {
    const { task } = await caspeTask();
    await completeTask(db, task.id, 'Contactado');
    await expect(completeTask(db, task.id, 'Contactado')).rejects.toThrow('ya fue procesada');
    expect(await db.activity.count({ where: { taskId: task.id } })).toBe(1);
  });

  it.each(['PAUSED', 'FINISHED'] as const)('%s cancela pendientes de hoy y conserva las completadas', async status => {
    const { cc, task } = await caspeTask();
    const other = await db.task.findFirstOrThrow({ where: { companyCadenceId: cc.id, id: { not: task.id } } });
    await db.task.update({ where: { id: other.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    await db.$transaction(tx => setCompanyCadenceStatus(tx, cc.id, status));
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('CANCELLED');
    expect((await db.task.findUniqueOrThrow({ where: { id: other.id } })).status).toBe('COMPLETED');
    expect(await db.task.count({ where: { companyCadenceId: cc.id, status: 'PENDING' } })).toBe(0);
  });

  it('borrar una empresa elimina sus tareas y actividades en cascada', async () => {
    const company = await db.company.create({ data: { name: 'Cascade test', normalizedName: randomUUID(), country: 'ES' } });
    companyIds.push(company.id);
    const task = await db.task.create({ data: { companyId: company.id, type: 'FOLLOW_UP', title: 'Cascada' } });
    await completeTask(db, task.id, 'Contactado');
    expect(await db.activity.findFirst({ where: { taskId: task.id, type: 'NOTE' } })).not.toBeNull();
    await db.company.delete({ where: { id: company.id } });
    expect(await db.task.findUnique({ where: { id: task.id } })).toBeNull();
    expect(await db.activity.count({ where: { companyId: company.id } })).toBe(0);
  });

  it('investiga y puntúa sin cambiar prioridad, versiona y aprueba un guion sin duplicar tareas', async () => {
    const company = await db.company.create({ data: { name: 'Empresa de pruebas', normalizedName: randomUUID(), country: 'ES', sector: 'Industria', comarca: 'Bajo Aragón', priority: 'C', nextActionAt: new Date('2026-11-23T00:00:00Z') } });
    companyIds.push(company.id);
    const first = await investigateCompany(db, company.id);
    const second = await investigateCompany(db, company.id);
    expect([first.version, second.version]).toEqual([1, 2]);
    expect(await db.researchReport.count({ where: { companyId: company.id } })).toBe(2);
    expect(first.score?.total).toBeGreaterThanOrEqual(0); expect(first.score?.total).toBeLessThanOrEqual(100);
    expect((await db.company.findUniqueOrThrow({ where: { id: company.id } })).priority).toBe('C');
    const actor = await db.user.findUniqueOrThrow({ where: { email: 'comercial@try.company' } });
    await applySuggestedPriority(db, company.id, actor.id);
    expect((await db.company.findUniqueOrThrow({ where: { id: company.id } })).priority).toBe(second.score!.suggestedPriority);
    const draft = await generateCompanyScript(db, company.id);
    expect(draft).toMatchObject({ author: 'IA', status: 'BORRADOR', version: 1 });
    expect(await db.task.count({ where: { companyId: company.id } })).toBe(0);
    expect(await db.companyCadence.count({ where: { companyId: company.id } })).toBe(0);
    await approveCompanyScript(db, draft.id, actor.id);
    expect(await db.task.count({ where: { scriptId: draft.id, assigneeId: actor.id } })).toBe(6);
    expect(await db.task.count({ where: { scriptId: draft.id, dueAt: new Date('2026-11-23T00:00:00Z') } })).toBe(2);
    await approveCompanyScript(db, draft.id, actor.id);
    expect(await db.task.count({ where: { scriptId: draft.id } })).toBe(6);
    expect((await db.script.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('APPROVED');
    expect(await db.aiRun.count({ where: { companyId: company.id, provider: 'mock', success: true } })).toBe(3);
  });

  it('una empresa suprimida no genera el siguiente paso al registrar un resultado', async () => {
    const { company, task, next } = await caspeTask();
    await db.suppressionList.create({ data: { companyId: company.id, reason: 'Test' } });
    await completeTask(db, task.id, 'No contesta');
    expect(await db.task.count({ where: { companyId: company.id, cadenceStepId: next.id } })).toBe(0);
  });

  it.each(['companyId', 'email', 'phone'] as const)('aprobar no genera tareas para una empresa suprimida por %s', async identifier => {
    const company = await db.company.create({ data: { name: 'Empresa suprimida', normalizedName: randomUUID(), country: 'ES', sector: 'Industria' } });
    companyIds.push(company.id);
    await db.contact.create({ data: { companyId: company.id, fullName: 'Contacto general', email: `${company.id}@example.test`, phone: `phone-${company.id}` } });
    await db.suppressionList.create({ data: { reason: 'Test', ...(identifier === 'companyId' ? { companyId: company.id } : identifier === 'email' ? { email: `${company.id}@example.test` } : { phone: `phone-${company.id}` }) } });
    await investigateCompany(db, company.id);
    const draft = await generateCompanyScript(db, company.id);
    await approveCompanyScript(db, draft.id);
    expect(await db.task.count({ where: { companyId: company.id } })).toBe(0);
    expect((await db.companyCadence.findFirstOrThrow({ where: { companyId: company.id } })).status).toBe('PAUSED');
  });

  async function prospectingProfile(maxResults = 3) {
    const profile = await db.searchProfile.create({ data: { name: 'Perfil de pruebas', active: true, country: 'ES', provinces: ['Teruel'], comarcas: ['Bajo Aragón'], municipalities: ['Alcañiz'], keywords: ['proveedor de pruebas'], cnaeCodes: [], productLine: 'Athenea', source: 'google-places', maxResults } });
    profileIds.push(profile.id); return profile;
  }
  it('el mock crea N Detectadas sin tareas, las encola y la segunda ejecución crea cero', async () => {
    const profile = await prospectingProfile();
    const [first] = await runProspecting(profile.id, { db });
    expect(first).toMatchObject({ source: 'mock', created: 3, errors: 0, duplicates: 0, status: 'SUCCESS' });
    const companies = await db.company.findMany({ where: { discoveryRunId: first.id }, include: { tasks: true, contacts: true } });
    expect(companies).toHaveLength(3);
    for (const company of companies) {
      expect(company.name).toContain('[SIMULADA]'); expect(company.fictional).toBe(true);
      expect(company.pipelineStage).toBe('DETECTED'); expect(company.priority).toBeNull();
      expect(company.detectedAt).not.toBeNull(); expect(company.researchQueuedAt).not.toBeNull(); expect(company.tasks).toHaveLength(0);
      expect(company.contacts[0]).toMatchObject({ fullName: 'Contacto general', legalBasis: 'LEGITIMATE_INTEREST', email: null, verified: false });
    }
    const [second] = await runProspecting(profile.id, { db });
    expect(second).toMatchObject({ created: 0, duplicates: 3, errors: 0 });
    expect(await db.company.count({ where: { discoveryRunId: first.id } })).toBe(3);
  });
  it('una empresa excluida y borrada no se recrea al volver a rastrear', async () => {
    const profile = await prospectingProfile(1);
    const [first] = await runProspecting(profile.id, { db });
    const company = await db.company.findFirstOrThrow({ where: { discoveryRunId: first.id } });
    await db.suppressionList.create({ data: { companyId: company.id, reason: 'prospecting-test' } });
    await db.company.delete({ where: { id: company.id } });
    expect(await db.suppressionList.findFirst({ where: { reason: 'prospecting-test', companyId: null, companyName: company.name } })).not.toBeNull();
    const [second] = await runProspecting(profile.id, { db });
    expect(second).toMatchObject({ created: 0, suppressed: 1, errors: 0 });
  });
  it.each(['domain', 'phone'] as const)('una exclusión por %s impide crear una empresa nueva', async identifier => {
    const profile = await prospectingProfile(1);
    const [candidate] = await sourceAdapter('mock').search(profile);
    candidate.corporatePhone = '976632132';
    await db.suppressionList.create({ data: { reason: 'prospecting-test', ...(identifier === 'domain' ? { domain: new URL(candidate.website!).hostname } : { phone: '+34 976 632 132' }) } });
    const adapter: SourceAdapter = { id: 'mock', search: async () => [candidate] };
    const [run] = await runProspecting(profile.id, { db, adapter });
    expect(run).toMatchObject({ created: 0, suppressed: 1, errors: 0 });
  });
  it('La Calandina ya sembrada se registra como duplicada sin crear empresa', async () => {
    const profile = await prospectingProfile(1);
    const [candidate] = await sourceAdapter('mock').search(profile);
    Object.assign(candidate, { name: 'LA CALANDINA Sociedad Cooperativa', city: 'Calanda', website: null });
    const before = await db.company.count();
    const [run] = await runProspecting(profile.id, { db, adapter: { id: 'mock', search: async () => [candidate] } });
    expect(run).toMatchObject({ created: 0, duplicates: 1, errors: 0 });
    expect(await db.company.count()).toBe(before); expect(JSON.stringify(run.matches)).toContain('NAME_CITY');
  });
  it('Google conserva sólo place_id y metadatos propios, sin cachear nombres, webs o teléfonos', async () => {
    const profile = await prospectingProfile(1);
    const candidate: CandidateCompany = { name: 'Nombre de Google no persistible', city: 'Alcañiz', province: 'Teruel', country: 'ES', address: 'Dirección no persistible', website: 'https://google-result.example.test', corporatePhone: '+34999999999', category: 'store', source: 'google-places', sourceRef: 'place-id-test', sourceUrl: 'https://www.google.com/maps', simulated: false };
    const [run] = await runProspecting(profile.id, { db, adapter: { id: 'google-places', search: async () => [candidate] } });
    expect(run).toMatchObject({ created: 1, errors: 0 });
    const company = await db.company.findFirstOrThrow({ where: { discoveryRunId: run.id }, include: { sourceIdentities: true, contacts: true } });
    expect(company.website).toBeNull(); expect(company.phone).toBeNull(); expect(company.address).toBeNull(); expect(company.contacts[0].phone).toBeNull();
    expect(company.name).not.toBe(candidate.name); expect(company.sourceIdentities[0].sourceRef).toBe('place-id-test');
    expect(JSON.stringify(run)).not.toContain(candidate.name); expect(JSON.stringify(run)).not.toContain(candidate.website!);
  });
  it('un perfil inactivo no ejecuta adaptadores', async () => {
    const profile = await prospectingProfile(1); await db.searchProfile.update({ where: { id: profile.id }, data: { active: false } });
    const search = vi.fn(); expect(await runProspecting(profile.id, { db, adapter: { id: 'mock', search } })).toEqual([]); expect(search).not.toHaveBeenCalled();
  });

  it('las empresas suprimidas con y sin guion no reciben tareas tras el seed', async () => {
    const companies = await db.company.findMany({ where: { sourceId: { in: ['la-calandina-s-coop', 'jamcal-alimentacion-sa'] } } });
    expect(companies).toHaveLength(2);
    const ids = companies.map(company => company.id);
    for (const company of companies) {
      expect(await db.task.count({ where: { companyId: company.id } })).toBeGreaterThan(0);
      await db.suppressionList.create({ data: { companyId: company.id, reason: 'Test de generación' } });
    }
    await db.task.deleteMany({ where: { companyId: { in: ids } } });
    await seed();
    for (const id of ids) expect(await db.task.count({ where: { companyId: id } })).toBe(0);
  }, 60_000);
});
