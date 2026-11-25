import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { isSafeTestDatabase } from '../test-database';
import { completeTask } from '../tasks';
import { generateJson } from '../llm';
import { TrygestionClient, TrygestionError } from './client';
import { enqueue, enqueueCompany, backfillCompanies } from './outbox';
import { processSyncOutbox, retryFailed, remoteWebsite, backoffMs } from './sync';
import { sendTaskEmail, unsubscribeToken, unsubscribeCompany, readUnsubscribeToken } from './email';
import { startTrygestionMock } from './testing/mock-server';

const url = process.env.TEST_DATABASE_URL;
const enabled = isSafeTestDatabase(url, process.env.DATABASE_URL);
const prisma = enabled ? new PrismaClient({ datasources: { db: { url } } }) : undefined;
// Referencia relativa al momento real: con una fecha fija, al pasar esa hora los trabajos
// recién encolados (nextAttemptAt = ahora) quedaban "en el futuro" y no se procesaban.
const T0 = new Date(Date.now() + 60_000);
const later = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

describe.runIf(enabled)('integración con trygestión (mock local con el comportamiento de producción)', () => {
  const db = prisma!;
  let mock: Awaited<ReturnType<typeof startTrygestionMock>>;
  let env: Record<string, string>;
  let client: () => TrygestionClient;
  let userId: string;
  const run = (now = T0, companyId?: string) => processSyncOutbox(db, { client: client(), now, limit: 100, ...(companyId ? { companyId } : {}) });
  /** Processes until nothing is due (dependent jobs are deferred one minute). */
  const drain = async (companyId?: string) => { for (let minute = 0; minute <= 10; minute += 2) await run(later(minute), companyId); };
  let counter = 0;
  const company = (data: Partial<Parameters<typeof db.company.create>[0]['data']> = {}) => {
    const name = String(data.name ?? `Prueba trygestión ${++counter}`);
    return db.company.create({ data: { country: 'ES', city: 'Alcañiz', region: 'Teruel', sector: 'Agroalimentario', priority: 'B', ...data, name, normalizedName: name.toLowerCase() } });
  };

  const originalPublicUrl = process.env.APP_PUBLIC_URL;
  beforeAll(async () => {
    // Los tests controlan la dirección pública (el .env de la torre la define).
    delete process.env.APP_PUBLIC_URL;
    mock = await startTrygestionMock();
    env = { TRYGESTION_URL: mock.url, TRYGESTION_TOKEN: mock.token, EMAIL_TRANSPORT: 'trygestion', AUTH_SECRET: 'secreto-de-pruebas-local', AUTH_URL: 'http://localhost:3000' };
    client = () => new TrygestionClient({ env });
    const user = await db.user.upsert({ where: { email: 'comercial-trygestion@test.local' }, update: { role: 'SALES' }, create: { email: 'comercial-trygestion@test.local', role: 'SALES', name: 'Comercial pruebas' } });
    userId = user.id;
  });
  beforeEach(async () => {
    await db.syncOutbox.deleteMany();
    await db.emailDispatch.deleteMany();
    await db.company.deleteMany({ where: { name: { startsWith: 'Prueba trygestión' } } });
    await db.suppressionList.deleteMany({ where: { reason: { contains: 'Baja' } , companyId: null } });
    for (const list of [mock.state.companies, mock.state.contacts, mock.state.opportunities, mock.state.activities, mock.state.events, mock.state.emails, mock.state.suppressions, mock.state.requests]) list.length = 0;
    mock.state.failures.clear();
  });
  afterAll(async () => {
    if (originalPublicUrl === undefined) delete process.env.APP_PUBLIC_URL; else process.env.APP_PUBLIC_URL = originalPublicUrl;
    await db.company.deleteMany({ where: { name: { startsWith: 'Prueba trygestión' } } });
    await db.syncOutbox.deleteMany(); await db.emailDispatch.deleteMany();
    await db.user.deleteMany({ where: { email: 'comercial-trygestion@test.local' } });
    await mock?.close(); await db.$disconnect();
  });

  it('sin TRYGESTION_URL/TOKEN la integración queda desactivada y no procesa nada', async () => {
    const local = await company();
    await enqueueCompany(db, local.id);
    const summary = await processSyncOutbox(db, { client: new TrygestionClient({ env: {} }), now: T0 });
    expect(summary.disabled).toBe(true);
    expect(await db.syncOutbox.count({ where: { status: 'PENDING' } })).toBe(1);
    expect(mock.state.requests).toHaveLength(0);
  });

  it('crea empresa, contacto y oportunidad en "Prospecto" con la marca de origen', async () => {
    const local = await company({ nifNit: 'B11111111', website: 'www.prueba-uno.test', email: 'info@prueba-uno.test', phone: '978000001', priority: 'A' });
    await db.contact.create({ data: { companyId: local.id, fullName: 'Recepción', email: 'info@prueba-uno.test', role: 'Administración' } });
    await backfillCompanies(db, local.id);
    await drain(local.id);
    const linked = await db.company.findUniqueOrThrow({ where: { id: local.id }, include: { contacts: true } });
    expect(mock.state.companies).toHaveLength(1);
    const remote = mock.state.companies[0];
    expect(remote).toMatchObject({ nombre: local.name, cif: 'B11111111', web: 'https://www.prueba-uno.test/', email: 'info@prueba-uno.test' });
    expect(String(remote.notas)).toContain('Origen: try! Comercial · prospecto · prioridad A');
    expect(linked.trygestionEmpresaId).toBe(remote.id);
    expect(mock.state.opportunities).toHaveLength(1);
    expect(mock.state.opportunities[0]).toMatchObject({ titulo: `Prospección · ${local.name}`, descripcion: `Oportunidad creada desde try! Comercial (ref try-comercial:${local.id}).`, empresa_id: remote.id, etapa_id: 'stage-1', estado: 'abierta' });
    expect(linked.trygestionOportunidadId).toBe(mock.state.opportunities[0].id);
    expect(mock.state.contacts).toEqual([expect.objectContaining({ empresa_id: remote.id, nombre: 'Recepción' })]);
    expect(linked.contacts[0].trygestionContactoId).toBe(mock.state.contacts[0].id);
    // Idempotent: a second backfill and run creates nothing new.
    await backfillCompanies(db, local.id); await drain(local.id);
    expect(mock.state.companies).toHaveLength(1); expect(mock.state.opportunities).toHaveLength(1); expect(mock.state.contacts).toHaveLength(1);
  });

  it('enlaza un cliente existente por CIF sin tocar sus datos (solo añade la línea de origen en notas)', async () => {
    mock.state.companies.push({ id: 'cliente-existente', nombre: 'Cliente Histórico SA', cif: 'B-22222222', direccion: 'Calle Mayor 1', ciudad: 'Caspe', telefono: '976000000', email: 'admin@cliente.test', web: 'https://cliente.test', sector: 'Industria', notas: 'Cliente desde 2020' });
    const local = await company({ nifNit: 'B22222222', name: 'Prueba trygestión Otro Nombre', website: 'https://otra-web.test' });
    await enqueueCompany(db, local.id); await drain(local.id);
    expect(mock.state.companies).toHaveLength(1);
    expect(mock.state.companies[0]).toMatchObject({ nombre: 'Cliente Histórico SA', direccion: 'Calle Mayor 1', ciudad: 'Caspe', telefono: '976000000', email: 'admin@cliente.test', web: 'https://cliente.test', sector: 'Industria' });
    expect(String(mock.state.companies[0].notas).split('\n')).toEqual(['Cliente desde 2020', 'Origen: try! Comercial · prospecto · prioridad B']);
    expect((await db.company.findUniqueOrThrow({ where: { id: local.id } })).trygestionEmpresaId).toBe('cliente-existente');
  });

  it('reconoce una oportunidad ya creada (por referencia o por el título antiguo) y no la duplica', async () => {
    const local = await company();
    await enqueueCompany(db, local.id); await drain(local.id);
    const remote = mock.state.opportunities[0];
    await db.company.update({ where: { id: local.id }, data: { trygestionOportunidadId: null } });
    await enqueueCompany(db, local.id, 'reintento'); await drain(local.id);
    expect(mock.state.opportunities).toHaveLength(1);
    Object.assign(remote, { titulo: `Prospección try! Comercial [${local.id}]`, descripcion: null });
    await db.company.update({ where: { id: local.id }, data: { trygestionOportunidadId: null } });
    await enqueueCompany(db, local.id, 'reintento-2'); await drain(local.id);
    expect(mock.state.opportunities).toHaveLength(1);
    expect((await db.company.findUniqueOrThrow({ where: { id: local.id } })).trygestionOportunidadId).toBe(remote.id);
  });

  it('escribe en trygestión el enlace a la ficha de try! Comercial y lo actualiza sin tocar las notas del cliente', async () => {
    process.env.APP_PUBLIC_URL = 'http://100.89.173.49:3001/';
    try {
      mock.state.companies.push({ id: 'cliente-con-notas', nombre: 'Prueba trygestión Cliente Con Notas SL', cif: 'B44444444', notas: 'Cliente desde 2019\nLlamar por la tarde' });
      const linked = await company({ nifNit: 'B44444444', name: 'Prueba trygestión Cliente Con Notas SL' });
      const fresh = await company();
      await enqueueCompany(db, linked.id); await enqueueCompany(db, fresh.id); await drain();
      const notesLinked = String(mock.state.companies.find(row => row.id === 'cliente-con-notas')!.notas).split('\n');
      expect(notesLinked).toEqual(['Cliente desde 2019', 'Llamar por la tarde', 'Origen: try! Comercial · prospecto · prioridad B', `Ficha en try! Comercial: http://100.89.173.49:3001/empresas/${linked.id}`]);
      const opportunity = mock.state.opportunities.find(row => String(row.descripcion).includes(fresh.id))!;
      expect(String(opportunity.descripcion)).toContain(`Ficha en try! Comercial: http://100.89.173.49:3001/empresas/${fresh.id}`);
      // Nueva dirección pública: al reencolar se reemplazan solo las líneas propias.
      process.env.APP_PUBLIC_URL = 'https://comercial.try.test';
      await enqueueCompany(db, linked.id); await drain();
      const updated = String(mock.state.companies.find(row => row.id === 'cliente-con-notas')!.notas).split('\n');
      expect(updated).toEqual(['Cliente desde 2019', 'Llamar por la tarde', 'Origen: try! Comercial · prospecto · prioridad B', `Ficha en try! Comercial: https://comercial.try.test/empresas/${linked.id}`]);
      const linkedOpportunity = mock.state.opportunities.find(row => row.empresa_id === 'cliente-con-notas')!;
      expect(String(linkedOpportunity.descripcion)).toContain(`https://comercial.try.test/empresas/${linked.id}`);
      // Si alguien del equipo reescribe la descripción en trygestión, no se pisa.
      linkedOpportunity.descripcion = 'Notas del comercial';
      process.env.APP_PUBLIC_URL = 'https://otra.try.test';
      await enqueueCompany(db, linked.id); await drain();
      expect(linkedOpportunity.descripcion).toBe('Notas del comercial');
    } finally { delete process.env.APP_PUBLIC_URL; }
  });

  it('enlaza también por dominio web y por nombre normalizado', async () => {
    mock.state.companies.push({ id: 'por-dominio', nombre: 'Distinto SL', web: 'https://www.dominio-igual.test/inicio', notas: null });
    mock.state.companies.push({ id: 'por-nombre', nombre: 'PRUEBA TRYGESTIÓN NOMBRE IGUAL, S.L.', notas: null });
    const byDomain = await company({ website: 'dominio-igual.test' });
    const byName = await company({ name: 'Prueba trygestión Nombre Igual SL', city: 'Calanda' });
    await enqueueCompany(db, byDomain.id); await enqueueCompany(db, byName.id); await drain();
    expect(mock.state.companies).toHaveLength(2);
    expect((await db.company.findUniqueOrThrow({ where: { id: byDomain.id } })).trygestionEmpresaId).toBe('por-dominio');
    expect((await db.company.findUniqueOrThrow({ where: { id: byName.id } })).trygestionEmpresaId).toBe('por-nombre');
  });

  it('si trygestión responde DUPLICATE_CIF, enlaza con la empresa existente', async () => {
    mock.state.companies.push({ id: 'dup', nombre: 'Dup SL', cif: 'B33333333', notas: null });
    const result = await client().crearEmpresa({ nombre: 'Otra', cif: 'b-33333333'.toUpperCase().replace('-', '') });
    expect(result).toEqual({ id: 'dup', linkedExisting: true });
  });

  it('actualizar la probabilidad no borra empresa, contacto ni responsable de la oportunidad', async () => {
    const local = await company({ priority: 'C' });
    await enqueueCompany(db, local.id); await drain(local.id);
    const opportunity = mock.state.opportunities[0];
    Object.assign(opportunity, { responsable_id: 'usuario-ventas', descripcion: 'Notas del equipo', contacto_id: 'contacto-x' });
    await db.company.update({ where: { id: local.id }, data: { priority: 'A' } });
    await enqueueCompany(db, local.id); await drain(local.id);
    expect(opportunity).toMatchObject({ probabilidad: 70, empresa_id: mock.state.companies[0].id, responsable_id: 'usuario-ventas', descripcion: 'Notas del equipo', contacto_id: 'contacto-x' });
    expect(String(mock.state.companies[0].notas)).toContain('prioridad A');
    expect(String(mock.state.companies[0].notas)).not.toContain('prioridad C');
  });

  it('una actividad de una empresa aún no enviada espera (no falla) y encola la empresa', async () => {
    const local = await company();
    const activity = await db.activity.create({ data: { companyId: local.id, type: 'NOTE', result: 'Nota suelta' } });
    await enqueue(db, 'ACTIVITY', activity.id, { companyId: local.id });
    const first = await run(T0, local.id);
    expect(first).toMatchObject({ deferred: 1, failed: 0 });
    expect(await db.syncOutbox.findFirstOrThrow({ where: { kind: 'ACTIVITY', entityId: activity.id } })).toMatchObject({ status: 'PENDING', attempts: 0, lastError: 'WAITING_COMPANY_UPSERT' });
    await drain(local.id);
    expect(mock.state.activities).toEqual([expect.objectContaining({ tipo: 'nota', titulo: 'Nota suelta' })]);
  });

  it('una llamada con reunión registra actividad, evento y etapa', async () => {
    const local = await company();
    const task = await db.task.create({ data: { companyId: local.id, type: 'CALL', title: 'Primera llamada' } });
    await completeTask(db, task.id, 'Reunión agendada', userId, { date: '2026-11-27', time: '10:30', location: 'Oficina del cliente' });
    await drain(local.id);
    expect(mock.state.activities).toEqual([expect.objectContaining({ tipo: 'llamada', titulo: 'Reunión agendada', descripcion: expect.stringContaining('Registrado por Comercial pruebas en try! Comercial.') })]);
    expect(String(mock.state.events[0].descripcion)).toContain('Agendada por Comercial pruebas desde try! Comercial.');
    expect(mock.state.events).toEqual([expect.objectContaining({ titulo: `Reunión con ${local.name}`, fecha_inicio: '2026-11-27', hora: '10:30', ambito: 'externo', entidad_externa: local.name, ubicacion: 'Oficina del cliente' })]);
    expect(mock.state.opportunities[0].etapa_id).toBe('stage-2');
    const activity = await db.activity.findFirstOrThrow({ where: { taskId: task.id } });
    expect(activity.trygestionActividadId).toBeTruthy(); expect(activity.trygestionEventoId).toBeTruthy();
    expect(await db.syncOutbox.count({ where: { status: { notIn: ['DONE'] } } })).toBe(0);
  });

  it('"No interesado" cierra la oportunidad como perdida con motivo_perdida', async () => {
    const local = await company();
    await enqueueCompany(db, local.id); await drain(local.id);
    const task = await db.task.create({ data: { companyId: local.id, type: 'CALL', title: 'Llamada' } });
    await completeTask(db, task.id, 'No interesado', userId); await drain(local.id);
    expect(mock.state.opportunities[0]).toMatchObject({ estado: 'perdida', motivo_perdida: 'No interesado', etapa_id: 'stage-7' });
  });

  it('una Baja envía a trygestión la supresión por email y dominio', async () => {
    const local = await company({ email: 'info@baja.test', website: 'https://www.baja.test' });
    await db.contact.create({ data: { companyId: local.id, fullName: 'Gerencia', email: 'gerencia@baja.test' } });
    await enqueueCompany(db, local.id); await drain(local.id);
    const task = await db.task.create({ data: { companyId: local.id, type: 'CALL', title: 'Llamada' } });
    await completeTask(db, task.id, 'Baja', userId); await drain(local.id);
    expect(mock.state.suppressions.map(row => row.email ?? row.dominio).sort()).toEqual(['baja.test', 'gerencia@baja.test', 'info@baja.test']);
  });

  it('reintenta con backoff tras un 500 y no reintenta un 401', async () => {
    const local = await company();
    mock.state.failures.set('POST /empresas', [500]);
    await enqueueCompany(db, local.id);
    await run(T0, local.id);
    const job = await db.syncOutbox.findFirstOrThrow({ where: { entityId: local.id, kind: 'COMPANY_UPSERT' } });
    expect(job).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'HTTP_500' });
    expect(job.nextAttemptAt.getTime()).toBe(T0.getTime() + backoffMs(1));
    await run(later(0.5), local.id);
    expect(mock.state.companies).toHaveLength(0);
    await run(later(2), local.id);
    expect(mock.state.companies).toHaveLength(1);

    const other = await company();
    await enqueueCompany(db, other.id);
    await processSyncOutbox(db, { client: new TrygestionClient({ env: { ...env, TRYGESTION_TOKEN: 'token-incorrecto' } }), now: T0, companyId: other.id });
    expect(await db.syncOutbox.findFirstOrThrow({ where: { entityId: other.id } })).toMatchObject({ status: 'FAILED', lastError: 'UNAUTHORIZED' });
    expect((await retryFailed(db)).count).toBe(1);
    await drain(other.id);
    expect(mock.state.companies).toHaveLength(2);
  });

  it('marca como fallida una etapa que no existe en trygestión (no la crea)', async () => {
    const local = await company();
    const original = process.env.TRYGESTION_STAGE_MAP;
    process.env.TRYGESTION_STAGE_MAP = JSON.stringify({ DETECTED: 'Etapa inexistente' });
    try {
      await enqueueCompany(db, local.id); await run(T0, local.id);
      expect(await db.syncOutbox.findFirstOrThrow({ where: { entityId: local.id } })).toMatchObject({ status: 'FAILED', lastError: 'STAGE_NOT_FOUND:Etapa inexistente' });
      expect(mock.state.requests.some(request => request.method === 'POST' && request.path === '/pipeline/etapas')).toBe(false);
    } finally { if (original === undefined) delete process.env.TRYGESTION_STAGE_MAP; else process.env.TRYGESTION_STAGE_MAP = original; }
  });

  it('las empresas pendientes de aceptar no se envían', async () => {
    const pending = await company({ acceptanceStatus: 'PENDING' });
    expect(await enqueueCompany(db, pending.id)).toBeNull();
    await drain(pending.id);
    expect(mock.state.companies).toHaveLength(0);
  });

  it('el email se envía por trygestión solo con aprobación, una vez, con BAJA y enlace de baja', async () => {
    const local = await company({ email: 'compras@cliente-email.test' });
    await enqueueCompany(db, local.id); await drain(local.id);
    const script = await db.script.create({ data: { companyId: local.id, author: 'test', content: {}, status: 'APPROVED' } });
    const task = await db.task.create({ data: { companyId: local.id, type: 'EMAIL', title: 'Email día 1', scriptId: script.id } });
    const input = { taskId: task.id, userId, approved: true, to: 'compras@cliente-email.test', subject: 'Propuesta', body: 'Hola, os escribimos desde try!' };
    await expect(sendTaskEmail(db, { ...input, approved: false }, { env, client: client() })).rejects.toThrow();
    await expect(sendTaskEmail(db, { ...input, to: 'otra@persona.test' }, { env, client: client() })).rejects.toThrow('EMAIL_RECIPIENT_NOT_COMPANY_CONTACT');
    expect(await sendTaskEmail(db, input, { env, client: client() })).toEqual({ sent: true, duplicate: false });
    expect(await sendTaskEmail(db, input, { env, client: client() })).toEqual({ sent: true, duplicate: true });
    expect(mock.state.emails).toHaveLength(1);
    const email = mock.state.emails[0];
    expect(email).toMatchObject({ to: 'compras@cliente-email.test', approvedBy: 'comercial-trygestion@test.local', externalRef: `task:${task.id}`, oportunidadId: mock.state.opportunities[0].id });
    expect(String(email.text)).toContain('BAJA'); expect(String(email.unsubscribeUrl)).toMatch(/^http:\/\/localhost:3000\/baja\//);
    expect(String(email.html)).not.toContain('<script');
    const remitente = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(email.firmante).toBe(remitente.name?.trim() || undefined);
    // Firma editable: lo que se escribe en el formulario se envía y queda guardado para el siguiente email.
    const task2 = await db.task.create({ data: { companyId: local.id, type: 'EMAIL', title: 'Email día 4', scriptId: script.id } });
    await sendTaskEmail(db, { ...input, taskId: task2.id, firmaNombre: 'Andrés Martínez', firmaCargo: 'Gerente' }, { env, client: client() });
    expect(mock.state.emails.at(-1)).toMatchObject({ firmante: 'Andrés Martínez', cargo: 'Gerente' });
    expect(await db.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({ signatureName: 'Andrés Martínez', signatureTitle: 'Gerente' });
    const task3 = await db.task.create({ data: { companyId: local.id, type: 'EMAIL', title: 'Email día 8', scriptId: script.id } });
    await sendTaskEmail(db, { ...input, taskId: task3.id }, { env, client: client() });
    expect(mock.state.emails.at(-1)).toMatchObject({ firmante: 'Andrés Martínez', cargo: 'Gerente' });
    await db.user.update({ where: { id: userId }, data: { signatureName: null, signatureTitle: null } });
    await expect(sendTaskEmail(db, { ...input, body: 'Texto cambiado' }, { env, client: client() })).rejects.toThrow('EMAIL_CONTENT_CHANGED');
  });

  it('nunca envía a trygestión una empresa simulada', async () => {
    const local = await company({ fictional: true, acceptanceStatus: 'ACCEPTED' });
    await enqueueCompany(db, local.id); await drain(local.id);
    expect(mock.state.companies.some(row => row.nombre === local.name)).toBe(false);
    expect(await db.syncOutbox.findFirst({ where: { entityId: local.id } })).toMatchObject({ status: 'SKIPPED' });
  });

  it('enviar una roja exige confirmación también en servidor y audita la excepción', async () => {
    const local = await company({ email: 'info@espera.test' });
    const script = await db.script.create({ data: { companyId: local.id, author: 'test', content: {}, status: 'APPROVED' } });
    const task = await db.task.create({ data: { companyId: local.id, type: 'EMAIL', title: 'Seguimiento futuro', scriptId: script.id, dueAt: new Date(Date.now() + 7 * 86400000) } });
    await db.activity.create({ data: { companyId: local.id, type: 'CALL' } });
    const input = { taskId: task.id, userId, approved: true, to: 'info@espera.test', subject: 'Hola', body: 'Texto' };
    await expect(sendTaskEmail(db, input, { env, client: client() })).rejects.toThrow('Sí, quiero contactarla igualmente');
    expect(mock.state.emails).toHaveLength(0);
    expect(await db.emailDispatch.count({ where: { companyId: local.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: local.id, action: 'CONTACT_WAIT_OVERRIDE' } })).toBe(0);
    expect(await sendTaskEmail(db, { ...input, contactConfirmed: true }, { env, client: client() })).toMatchObject({ sent: true });
    expect(mock.state.emails).toHaveLength(1);
    expect(await db.auditLog.findFirst({ where: { entityId: local.id, action: 'CONTACT_WAIT_OVERRIDE' } })).toMatchObject({ userId, metadata: { action: 'SEND_EMAIL' } });
  });

  it('si la empresa no tiene email, el destinatario aprobado se guarda como su email corporativo', async () => {
    const local = await company({});
    const script = await db.script.create({ data: { companyId: local.id, author: 'test', content: {}, status: 'APPROVED' } });
    const task = await db.task.create({ data: { companyId: local.id, type: 'EMAIL', title: 'Email día 1', scriptId: script.id } });
    const input = { taskId: task.id, userId, approved: true, to: 'Info@Sin-Email.test', subject: 'Hola', body: 'Texto' };
    expect(await sendTaskEmail(db, input, { env, client: client() })).toEqual({ sent: true, duplicate: false });
    expect((await db.company.findUniqueOrThrow({ where: { id: local.id } })).email).toBe('info@sin-email.test');
    expect(await db.auditLog.count({ where: { entityId: local.id, action: 'EMAIL_ADDED_FROM_MI_DIA' } })).toBe(1);
    expect(await db.syncOutbox.count({ where: { entityId: local.id } })).toBeGreaterThan(0);
    const task2 = await db.task.create({ data: { companyId: local.id, type: 'EMAIL', title: 'Email día 6', scriptId: script.id } });
    await expect(sendTaskEmail(db, { ...input, taskId: task2.id, to: 'otra@sin-email.test' }, { env, client: client() })).rejects.toThrow('EMAIL_RECIPIENT_NOT_COMPANY_CONTACT');
  });

  it('no envía emails a una empresa suprimida ni si el transporte no es trygestión', async () => {
    const local = await company({ email: 'info@suprimida.test' });
    const script = await db.script.create({ data: { companyId: local.id, author: 'test', content: {}, status: 'APPROVED' } });
    const task = await db.task.create({ data: { companyId: local.id, type: 'EMAIL', title: 'Email', scriptId: script.id } });
    const input = { taskId: task.id, userId, approved: true, to: 'info@suprimida.test', subject: 'Hola', body: 'Texto' };
    await expect(sendTaskEmail(db, input, { env: { ...env, EMAIL_TRANSPORT: 'copy' }, client: client() })).rejects.toThrow('EMAIL_COPY_ONLY');
    await db.suppressionList.create({ data: { companyId: local.id, reason: 'Baja solicitada' } });
    await expect(sendTaskEmail(db, input, { env, client: client() })).rejects.toThrow('COMPANY_SUPPRESSED');
    expect(mock.state.emails).toHaveLength(0);
  });

  it('el enlace de baja firmado registra la supresión, cancela tareas y avisa a trygestión', async () => {
    const local = await company({ email: 'info@enlace-baja.test' });
    await enqueueCompany(db, local.id); await drain(local.id);
    await db.task.create({ data: { companyId: local.id, type: 'CALL', title: 'Pendiente' } });
    const token = unsubscribeToken(local.id, env.AUTH_SECRET);
    expect(readUnsubscribeToken(`${token}x`, env.AUTH_SECRET)).toBeNull();
    expect(readUnsubscribeToken(token, 'otro-secreto')).toBeNull();
    await expect(unsubscribeCompany(db, `${token}x`, env.AUTH_SECRET)).rejects.toBeInstanceOf(TrygestionError);
    await unsubscribeCompany(db, token, env.AUTH_SECRET);
    expect(await db.suppressionList.count({ where: { companyId: local.id } })).toBe(1);
    expect(await db.task.count({ where: { companyId: local.id, status: 'PENDING' } })).toBe(0);
    await drain(local.id);
    expect(mock.state.suppressions.map(row => row.email ?? row.dominio)).toContain('info@enlace-baja.test');
  });

  it('el proveedor de IA "trygestion" usa la clave del tenant vía trygestión y valida el JSON', async () => {
    const local = await company();
    mock.state.iaJson = { resumen: 'Empresa agroalimentaria de Alcañiz' };
    const result = await generateJson({ system: 'Solo JSON', prompt: 'Resume', schema: z.object({ resumen: z.string() }) }, { db, companyId: local.id, purpose: 'test', mockResponse: { resumen: 'mock' }, env: { LLM_PROVIDER: 'trygestion', ...env } });
    expect(result).toEqual({ resumen: 'Empresa agroalimentaria de Alcañiz' });
    const call = mock.state.requests.find(request => request.path === '/comercial/ia/generar');
    expect(call?.body).toMatchObject({ system: 'Solo JSON', prompt: 'Resume', schema: expect.objectContaining({ type: 'object' }) });
    expect(await db.aiRun.findFirst({ where: { companyId: local.id }, orderBy: { createdAt: 'desc' } })).toMatchObject({ provider: 'trygestion', model: 'tenant-mock-model', success: true });
  });

  it('normaliza la web para la validación de trygestión', () => {
    expect(remoteWebsite('www.ejemplo.test')).toBe('https://www.ejemplo.test/');
    expect(remoteWebsite('http://ejemplo.test/a')).toBe('http://ejemplo.test/a');
    expect(remoteWebsite('')).toBeNull(); expect(remoteWebsite('javascript:alert(1)')).toBeNull();
  });
});
