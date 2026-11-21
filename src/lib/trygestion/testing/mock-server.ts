import { createServer, type Server } from 'node:http';

type RecordData = Record<string, unknown> & { id: string };
export type MockState = {
  companies: RecordData[]; contacts: RecordData[]; opportunities: RecordData[]; activities: RecordData[];
  events: RecordData[]; emails: RecordData[]; suppressions: RecordData[];
  requests: { method: string; path: string; body: Record<string, unknown>; key?: string }[];
  failures: Map<string, number[]>; stages: { id: string; nombre: string }[]; iaJson: unknown;
};
/** Local-only test double: credentials, clients and messages are fictitious. */
export async function startTrygestionMock(port = 0) {
  const token = 'trygestion-local-test-token'; let sequence = 0;
  const state: MockState = { companies: [], contacts: [], opportunities: [], activities: [], events: [], emails: [], suppressions: [], requests: [], failures: new Map(),
    stages: ['Prospecto', 'Contactado', 'Reunión', 'Propuesta', 'Negociación', 'Ganado', 'Perdido'].map((nombre, index) => ({ id: String(index + 1), nombre })), iaJson: { ok: true } };
  const keys = new Map<string, unknown>();
  const server: Server = createServer(async (request, response) => {
    const send = (status: number, value: unknown) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.headers.authorization !== `Bearer ${token}`) { send(401, { error: 'Unauthorized' }); return; }
    const url = new URL(request.url ?? '/', 'http://localhost'); const path = url.pathname.replace(/^\/api/, ''); const method = request.method ?? 'GET';
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    let body: Record<string, unknown>; try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { send(400, {}); return; }
    const key = request.headers['idempotency-key']?.toString(); state.requests.push({ method, path, body, key });
    const fail = state.failures.get(`${method} ${path}`)?.shift(); if (fail) { send(fail, { error: 'Simulated failure' }); return; }
    const lookup = key ? `${method}:${path}:${key}` : undefined;
    if (lookup && keys.has(lookup)) { send(200, keys.get(lookup)); return; }
    const finish = (value: unknown, status = 200) => { if (lookup && status < 300) keys.set(lookup, value); send(status, value); };
    if (path === '/comercial/estado') { finish({ tenant: 'Tenant de pruebas local', smtp: true, ia: true, googleCalendar: true, etapas: state.stages }); return; }
    if (path === '/pipeline/etapas') { finish(state.stages); return; }
    if (path === '/comercial/ia/generar') { finish({ json: state.iaJson, model: 'tenant-mock-model', usage: { input_tokens: 12, output_tokens: 20 } }); return; }
    if (path === '/comercial/email/enviar') {
      if (!body.approvedBy || !body.externalRef || !String(body.text).includes('BAJA') || !body.unsubscribeUrl) { finish({ error: 'Approval and unsubscribe required' }, 422); return; }
      if (state.suppressions.some(row => row.email === body.to || row.dominio === String(body.to).split('@')[1])) { finish({}, 403); return; }
      let email = state.emails.find(row => row.externalRef === body.externalRef);
      if (!email) { email = { ...body, id: `email-${++sequence}` }; state.emails.push(email); if (body.oportunidadId) state.activities.push({ id: `activity-${++sequence}`, tipo: 'email', oportunidad_id: body.oportunidadId }); }
      finish({ messageId: email.id, ok: true }); return;
    }
    if (path === '/comercial/supresion') { state.suppressions.push({ ...body, id: `suppression-${++sequence}` }); finish({ ok: true }); return; }
    const resource = path === '/empresas' || /^\/empresas\/[^/]+$/.test(path) ? state.companies : path === '/contactos' ? state.contacts : path.startsWith('/pipeline/oportunidades') && !path.endsWith('/actividades') ? state.opportunities : path.endsWith('/actividades') ? state.activities : path === '/eventos' ? state.events : null;
    if (!resource) { finish({ error: 'Unknown endpoint' }, 404); return; }
    const segments = path.split('/').filter(Boolean); const remoteId = segments[0] === 'pipeline' ? segments[2] : segments[1];
    if (method === 'GET') {
      if (remoteId) { const row = resource.find(row => row.id === remoteId); finish(row ?? {}, row ? 200 : 404); }
      else { const empresa = url.searchParams.get('empresa_id'); finish(empresa ? resource.filter(row => String(row.empresa_id) === empresa) : resource); }
      return;
    }
    if (method === 'POST') { const row = { ...body, id: `remote-${++sequence}`, ...(path.endsWith('/actividades') ? { oportunidad_id: remoteId } : {}) }; resource.push(row); finish(row, 201); return; }
    const row = resource.find(row => row.id === remoteId); if (!row) { finish({}, 404); return; }
    Object.assign(row, body); finish({ ok: true });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('MOCK_LISTEN_FAILED');
  return { state, token, url: `http://127.0.0.1:${address.port}/api`, close: () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }) };
}
