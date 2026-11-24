import { createServer, type Server } from 'node:http';

type RecordData = Record<string, unknown> & { id: string };
export type MockState = {
  replies: RecordData[]; companies: RecordData[]; contacts: RecordData[]; opportunities: RecordData[]; activities: RecordData[];
  events: RecordData[]; emails: RecordData[]; suppressions: RecordData[];
  requests: { method: string; path: string; body: Record<string, unknown>; key?: string }[];
  failures: Map<string, number[]>; stages: { id: string; nombre: string; tipo_final: string | null }[]; iaJson: unknown;
};

/**
 * Local-only test double of the trygestión API (credentials, clients and messages are fictitious).
 * It reproduces the production behaviours the integration depends on (read from the live code, 21/11/2026):
 * - `GET /empresas?search=` filters by name only;
 * - `POST /empresas` rejects a repeated CIF with 400 `DUPLICATE_CIF` + `empresaExistenteId`;
 * - `PUT /empresas/:id` overwrites every column (missing fields become null);
 * - `PUT /pipeline/oportunidades/:id` coalesces only titulo/etapa/valor/probabilidad and nulls the rest;
 * - `PUT …/estado` accepts only ganada|perdida and stores `motivo_perdida`;
 * - activity types are restricted to the production CHECK constraint;
 * - default stages are those of `POST /pipeline/inicializar-etapas`;
 * - the `Idempotency-Key` header is ignored (it is sent anyway, for the future).
 */
export async function startTrygestionMock(port = 0) {
  const token = 'trygestion-local-test-token'; let sequence = 0;
  const defaultStages: [string, string | null][] = [['Prospecto', null], ['Contacto inicial', null], ['Propuesta enviada', null], ['Negociacion', null], ['Compromiso verbal', null], ['Cerrado ganado', 'ganada'], ['Cerrado perdido', 'perdida']];
  const state: MockState = { replies: [], companies: [], contacts: [], opportunities: [], activities: [], events: [], emails: [], suppressions: [], requests: [], failures: new Map(),
    stages: defaultStages.map(([nombre, tipo_final], index) => ({ id: `stage-${index + 1}`, nombre, tipo_final })), iaJson: { ok: true } };
  const nextId = (prefix: string) => `${prefix}-${String(++sequence).padStart(4, '0')}-0000-4000-8000-000000000000`;
  const server: Server = createServer(async (request, response) => {
    const send = (status: number, value: unknown) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.headers.authorization !== `Bearer ${token}`) { send(401, { error: 'No autorizado' }); return; }
    const url = new URL(request.url ?? '/', 'http://localhost'); const path = url.pathname.replace(/^\/api/, ''); const method = request.method ?? 'GET';
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    let body: Record<string, unknown>; try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { send(400, { error: 'JSON inválido' }); return; }
    const key = request.headers['idempotency-key']?.toString(); state.requests.push({ method, path, body, key });
    const fail = state.failures.get(`${method} ${path}`)?.shift(); if (fail) { send(fail, { error: 'Fallo simulado' }); return; }
    // Production ignores Idempotency-Key: only the new /comercial endpoints are idempotent (by externalRef).
    const finish = (value: unknown, status = 200) => send(status, value);
    const segments = path.split('/').filter(Boolean);

    if (path === '/comercial/respuestas' && method === 'GET') {
      const desde = url.searchParams.get('desde');
      if (desde && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(desde)) { finish({ error: 'desde inválido' }, 400); return; }
      finish({ respuestas: state.replies.filter(row => !desde || String(row.creado_en) >= desde).sort((a,b) => String(a.creado_en).localeCompare(String(b.creado_en))).slice(0, Math.min(100, Number(url.searchParams.get('limite') ?? 100))) }); return;
    }
    if (path === '/comercial/estado' && method === 'GET') { finish({ tenant: 'Tenant de pruebas local', smtp: true, ia: true, googleCalendar: true, etapas: state.stages }); return; }
    if (path === '/comercial/ia/generar' && method === 'POST') { finish({ json: state.iaJson, model: 'tenant-mock-model', usage: { input_tokens: 12, output_tokens: 20 } }); return; }
    if (path === '/comercial/email/enviar' && method === 'POST') {
      if (!body.approvedBy || !body.externalRef || !String(body.text).includes('BAJA') || !body.unsubscribeUrl) { finish({ error: 'Se requiere aprobación y enlace de baja' }, 422); return; }
      const to = String(body.to).toLowerCase();
      if (state.suppressions.some(row => row.email === to || row.dominio === to.split('@')[1])) { finish({ error: 'Destinatario suprimido' }, 403); return; }
      let email = state.emails.find(row => row.externalRef === body.externalRef);
      if (!email) { email = { ...body, id: nextId('email') }; state.emails.push(email); if (body.oportunidadId) state.activities.push({ id: nextId('act'), tipo: 'email', titulo: String(body.subject), oportunidad_id: body.oportunidadId }); }
      finish({ messageId: email.id, ok: true }); return;
    }
    if (path === '/comercial/supresion' && method === 'POST') {
      const value = String(body.email ?? body.dominio ?? '').toLowerCase(); if (!value) { finish({ error: 'email o dominio obligatorio' }, 400); return; }
      if (!state.suppressions.some(row => row.email === value || row.dominio === value)) state.suppressions.push({ id: nextId('sup'), ...(body.email ? { email: value } : { dominio: value }), motivo: body.motivo });
      finish({ ok: true }); return;
    }

    // ---- empresas
    if (segments[0] === 'empresas') {
      const id = segments[1];
      if (method === 'GET' && !id) { const search = url.searchParams.get('search')?.toLowerCase(); send(200, search ? state.companies.filter(row => String(row.nombre).toLowerCase().includes(search)) : state.companies); return; }
      if (method === 'GET') { const row = state.companies.find(item => item.id === id); send(row ? 200 : 404, row ?? { error: 'No encontrado' }); return; }
      if (method === 'POST' && !id) {
        if (!body.nombre) { finish({ error: 'El nombre de la empresa es obligatorio' }, 400); return; }
        if (body.web && !/^https?:\/\//.test(String(body.web))) { finish({ error: 'URL no valida' }, 400); return; }
        const cif = String(body.cif ?? '').trim().toUpperCase();
        const duplicate = cif && state.companies.find(row => String(row.cif ?? '').trim().toUpperCase() === cif);
        if (duplicate) { finish({ error: `Ya existe un cliente con el CIF ${cif}: ${duplicate.nombre}`, code: 'DUPLICATE_CIF', empresaExistenteId: duplicate.id }, 400); return; }
        const row: RecordData = { id: nextId('emp'), nombre: body.nombre, cif: body.cif ?? null, direccion: body.direccion ?? null, ciudad: body.ciudad ?? null, telefono: body.telefono ?? null, email: body.email ?? null, web: body.web ?? null, sector: body.sector ?? null, notas: body.notas ?? null, activo: 1 };
        state.companies.push(row); finish(row, 201); return;
      }
      if (method === 'PUT' && id) {
        const row = state.companies.find(item => item.id === id); if (!row) { finish({ error: 'No encontrado' }, 404); return; }
        // Production overwrites every column with what it receives.
        for (const field of ['nombre', 'cif', 'direccion', 'ciudad', 'telefono', 'email', 'web', 'sector', 'notas']) row[field] = body[field] ?? null;
        finish(row); return;
      }
    }

    // ---- contactos
    if (segments[0] === 'contactos') {
      if (method === 'GET' && !segments[1]) { const empresa = url.searchParams.get('empresa_id'); send(200, empresa ? state.contacts.filter(row => row.empresa_id === empresa) : state.contacts); return; }
      if (method === 'POST' && !segments[1]) { if (!body.nombre) { finish({ error: 'El nombre es obligatorio' }, 400); return; } const row: RecordData = { id: nextId('con'), nombre: body.nombre, email: body.email ?? null, telefono: body.telefono ?? null, cargo: body.cargo ?? null, empresa_id: body.empresa_id ?? null }; state.contacts.push(row); finish(row, 201); return; }
    }

    // ---- pipeline
    if (segments[0] === 'pipeline') {
      if (path === '/pipeline/etapas' && method === 'GET') { send(200, state.stages); return; }
      if (segments[1] === 'oportunidades') {
        const id = segments[2]; const action = segments[3];
        if (method === 'GET' && !id) { const empresa = url.searchParams.get('empresa_id'); send(200, empresa ? state.opportunities.filter(row => row.empresa_id === empresa) : state.opportunities); return; }
        const row = id ? state.opportunities.find(item => item.id === id) : undefined;
        if (method === 'GET' && id && !action) { send(row ? 200 : 404, row ?? { error: 'Oportunidad no encontrada' }); return; }
        if (method === 'POST' && !id) {
          if (!body.titulo) { finish({ error: 'El titulo es obligatorio' }, 400); return; }
          const created: RecordData = { id: nextId('opo'), titulo: body.titulo, descripcion: body.descripcion ?? null, empresa_id: body.empresa_id ?? null, contacto_id: body.contacto_id ?? null, etapa_id: body.etapa_id ?? state.stages[0].id, valor_estimado: body.valor_estimado ?? 0, probabilidad: body.probabilidad ?? 0, responsable_id: body.responsable_id ?? null, estado: 'abierta' };
          state.opportunities.push(created); finish(created, 201); return;
        }
        if (!row) { finish({ error: 'Oportunidad no encontrada' }, 404); return; }
        if (method === 'PUT' && !action) {
          for (const field of ['titulo', 'etapa_id', 'valor_estimado', 'probabilidad']) if (body[field] !== undefined && body[field] !== null) row[field] = body[field];
          for (const field of ['descripcion', 'empresa_id', 'contacto_id', 'fecha_cierre_estimada', 'responsable_id', 'cotizacion_id', 'proyecto_id', 'categoria']) row[field] = body[field] ?? null;
          finish(row); return;
        }
        if (method === 'PUT' && action === 'etapa') { if (!body.etapa_id) { finish({ error: 'Se requiere etapa_id' }, 400); return; } row.etapa_id = body.etapa_id; finish(row); return; }
        if (method === 'PUT' && action === 'estado') {
          if (!['ganada', 'perdida'].includes(String(body.estado))) { finish({ error: 'Estado debe ser "ganada" o "perdida"' }, 400); return; }
          row.estado = body.estado; row.motivo_perdida = body.estado === 'perdida' ? body.motivo_perdida ?? null : null;
          row.etapa_id = state.stages.find(stage => stage.tipo_final === body.estado)?.id ?? row.etapa_id; finish(row); return;
        }
        if (method === 'POST' && action === 'actividades') {
          if (!body.tipo || !body.titulo) { finish({ error: 'Tipo y titulo son obligatorios' }, 400); return; }
          if (!['llamada', 'email', 'reunion', 'nota', 'tarea', 'demo', 'visita'].includes(String(body.tipo))) { finish({ error: 'CHECK constraint failed: tipo' }, 500); return; }
          const created: RecordData = { id: nextId('act'), oportunidad_id: id, tipo: body.tipo, titulo: body.titulo, descripcion: body.descripcion ?? null, fecha_programada: body.fecha_programada ?? null };
          state.activities.push(created); finish(created, 201); return;
        }
      }
    }

    // ---- eventos
    if (path === '/eventos' && method === 'POST') {
      if (!body.titulo || !body.fecha_inicio) { finish({ error: 'Error' }, 500); return; }
      const created: RecordData = { id: nextId('evt'), ...body }; state.events.push(created); finish(created, 201); return;
    }
    finish({ error: 'Endpoint desconocido' }, 404);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('MOCK_LISTEN_FAILED');
  return { state, token, url: `http://127.0.0.1:${address.port}/api`, close: () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }) };
}
