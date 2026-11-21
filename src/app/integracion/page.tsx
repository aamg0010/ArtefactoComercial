import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { TrygestionClient, TrygestionError } from '@/lib/trygestion/client';
import { processNow, retryNow } from './actions';

export const dynamic = 'force-dynamic';

const statusLabels = [['PENDING', 'Pendientes'], ['PROCESSING', 'En curso'], ['DONE', 'Enviados'], ['FAILED', 'Fallidos'], ['SKIPPED', 'Omitidos']] as const;
const kindLabels: Record<string, string> = { COMPANY_UPSERT: 'Empresa', CONTACT_UPSERT: 'Contacto', OPPORTUNITY_STAGE: 'Etapa', OPPORTUNITY_STATUS: 'Ganada/perdida', ACTIVITY: 'Actividad', EVENT: 'Reunión', SUPPRESSION: 'Baja' };

export default async function IntegrationPage() {
  const session = await auth(); if (!session?.user) redirect('/login'); if (session.user.role !== 'ADMIN') redirect('/');
  let client: TrygestionClient | null = null; let status = 'Desactivada: configura TRYGESTION_URL y TRYGESTION_TOKEN en .env.';
  try { client = new TrygestionClient(); } catch { status = 'Configuración no válida: revisa TRYGESTION_URL.'; }
  if (client?.enabled) try {
    const state = await client.estado();
    const tenant = typeof state.tenant === 'object' ? JSON.stringify(state.tenant) : state.tenant;
    status = `Activada · Tenant: ${tenant} · SMTP: ${state.smtp ? 'sí' : 'no'} · IA: ${state.ia ? 'sí' : 'no'} · Google Calendar: ${state.googleCalendar ? 'sí' : 'no'}`;
  } catch (error) { status = `Activada · Error de conexión: ${error instanceof TrygestionError ? error.code : 'CONFIGURATION_ERROR'}`; }
  const counts = await prisma.syncOutbox.groupBy({ by: ['status'], _count: true });
  const errors = await prisma.syncOutbox.findMany({ where: { status: { in: ['FAILED', 'PENDING'] }, lastError: { not: null } }, orderBy: { updatedAt: 'desc' }, take: 20 });
  const linked = await prisma.company.count({ where: { trygestionEmpresaId: { not: null } } });
  return <main className="mx-auto max-w-5xl space-y-5 p-5">
    <h1 className="text-2xl font-bold">Integración con trygestión</h1>
    <p role="status">{status}</p>
    <p>Empresas enlazadas con trygestión: {linked}</p>
    <section aria-label="Cola de sincronización"><h2 className="text-xl">Cola de sincronización</h2>
      <ul>{statusLabels.map(([value, label]) => <li key={value}>{label}: <span data-status={value}>{counts.find(row => row.status === value)?._count ?? 0}</span></li>)}</ul>
    </section>
    <div className="flex gap-4">
      <form action={processNow}><button disabled={!client?.enabled}>Procesar ahora</button></form>
      <form action={retryNow}><button>Reintentar fallidos</button></form>
    </div>
    <section aria-label="Últimos errores"><h2 className="text-xl">Últimos errores</h2>
      {errors.length === 0 ? <p>Sin errores.</p> : <ul>{errors.map(error => <li key={error.id}>{kindLabels[error.kind] ?? error.kind} · {error.entityId} · {error.status === 'FAILED' ? 'fallido' : 'reintentará'} · intentos {error.attempts} · {error.lastError}</li>)}</ul>}
    </section>
  </main>;
}
