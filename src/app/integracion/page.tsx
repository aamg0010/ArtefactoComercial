import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { TrygestionClient, TrygestionError } from '@/lib/trygestion/client';
import { processNow, retryNow } from './actions';
import { trygestionWebUrl } from '@/lib/trygestion/links';

export const dynamic = 'force-dynamic';

const statusLabels = [['PENDING', 'Pendientes'], ['PROCESSING', 'En curso'], ['DONE', 'Enviados'], ['FAILED', 'Fallidos'], ['SKIPPED', 'Omitidos']] as const;
const kindLabels: Record<string, string> = { COMPANY_UPSERT: 'Empresa', CONTACT_UPSERT: 'Contacto', OPPORTUNITY_STAGE: 'Etapa', OPPORTUNITY_STATUS: 'Ganada/perdida', ACTIVITY: 'Actividad', EVENT: 'Reunión', SUPPRESSION: 'Baja' };

export default async function IntegrationPage() {
  const session = await auth(); if (!session?.user) redirect('/login'); if (session.user.role === 'DIRECTOR') redirect('/');
  let client: TrygestionClient | null = null; let status = 'Desactivada: configura TRYGESTION_URL y TRYGESTION_TOKEN en .env.';
  try { client = new TrygestionClient(); } catch { status = 'Configuración no válida: revisa TRYGESTION_URL.'; }
  if (client?.enabled) try {
    const state = await client.estado();
    const tenant = typeof state.tenant === 'object' ? JSON.stringify(state.tenant) : state.tenant;
    status = `Activada · Tenant: ${tenant} · SMTP: ${state.smtp ? 'sí' : 'no'} · IA: ${state.ia ? 'sí' : 'no'} · Google Calendar: ${state.googleCalendar ? 'sí' : 'no'}`;
  } catch (error) { status = `Activada · Error de conexión: ${error instanceof TrygestionError ? error.code : 'CONFIGURATION_ERROR'}`; }
  const replyCounts = await prisma.emailReply.groupBy({ by: ['status'], _count: true });
  const replySync = await prisma.emailReplySync.findUnique({ where: { id: 'trygestion' } });
  const counts = await prisma.syncOutbox.groupBy({ by: ['status'], _count: true });
  const errors = await prisma.syncOutbox.findMany({ where: { status: { in: ['FAILED', 'PENDING'] }, lastError: { not: null } }, orderBy: { updatedAt: 'desc' }, take: 20 });
  const linked = await prisma.company.count({ where: { trygestionEmpresaId: { not: null } } });
  return <main className="mx-auto max-w-5xl space-y-5 p-5">
    <h1 className="page-title">Integración con trygestión</h1>
    <p role="status">{status}</p>
    <p className="font-display text-sm text-slate-600">Empresas enlazadas con trygestión: <span className="font-semibold text-try-700">{linked}</span></p>
    <section aria-label="Cola de sincronización" className="card"><h2 className="font-display text-lg font-semibold">Cola de sincronización</h2>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">{statusLabels.map(([value, label]) => <li key={value} className="rounded-xl border border-slate-200 bg-try-50/40 p-3 font-display"><span className="block text-xs uppercase tracking-wide text-slate-500">{label}</span><span data-status={value} className="text-2xl font-semibold text-try-800">{counts.find(row => row.status === value)?._count ?? 0}</span></li>)}</ul>
    </section>
    <section aria-label="Sincronización de respuestas" className="card p-4">
      <h2>Respuestas recibidas</h2>
      <p>Nuevas: {replyCounts.find(row => row.status === 'NEW')?._count ?? 0} · Gestionadas: {replyCounts.find(row => row.status === 'HANDLED')?._count ?? 0}</p>
      <p>Cursor (UTC): {replySync?.cursor ?? 'Sin sincronizar'}</p>
      {replySync?.lastError && <p role="alert">Error de respuestas: {replySync.lastError === 'REPLY_CURSOR_SATURATED' ? 'Hay 100 respuestas en el mismo segundo. Se conserva el cursor; trygestión necesita paginación adicional para continuar.' : replySync.lastError}</p>}
    </section>
    <div className="flex gap-4">
      <form action={processNow}><button disabled={!client?.enabled}>Procesar ahora</button></form>
      <form action={retryNow}><button className="btn-secondary">Reintentar fallidos</button></form>
    </div>
    <section aria-label="Últimos errores" className="card"><h2 className="font-display text-lg font-semibold">Últimos errores</h2>
      {errors.length === 0 ? <p className="mt-2 font-display text-sm text-slate-500">Sin errores.</p> : <ul className="mt-3 space-y-1 font-display text-sm">{errors.map(error => <li key={error.id}>{kindLabels[error.kind] ?? error.kind} · {error.entityId} · {error.status === 'FAILED' ? 'fallido' : 'reintentará'} · intentos {error.attempts} · {error.lastError}</li>)}</ul>}
    </section>
  </main>;
}
