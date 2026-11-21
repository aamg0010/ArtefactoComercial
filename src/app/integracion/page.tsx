import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { TrygestionClient, TrygestionError } from '@/lib/trygestion/client';
import { processNow, retryNow } from './actions';
export default async function IntegrationPage() {
  const session = await auth(); if (!session?.user) redirect('/login'); if (session.user.role !== 'ADMIN') redirect('/');
  const client = new TrygestionClient(); let status = 'Desactivada: configura TRYGESTION_URL y TRYGESTION_TOKEN.';
  if (client.enabled) try { const state = await client.estado(); status = `Activada · Tenant: ${typeof state.tenant === 'object' ? JSON.stringify(state.tenant) : state.tenant} · SMTP: ${state.smtp ? 'sí' : 'no'} · IA: ${state.ia ? 'sí' : 'no'} · Google Calendar: ${state.googleCalendar ? 'sí' : 'no'}`; } catch (error) { status = `Activada · Error de conexión: ${error instanceof TrygestionError ? error.code : 'CONFIGURATION_ERROR'}`; }
  const counts = await prisma.syncOutbox.groupBy({ by: ['status'], _count: true });
  const errors = await prisma.syncOutbox.findMany({ where: { lastError: { not: null } }, orderBy: { updatedAt: 'desc' }, take: 20 });
  return <main className="mx-auto max-w-5xl space-y-5 p-5"><h1 className="text-2xl font-bold">Integración con trygestión</h1><p role="status">{status}</p>
    <section aria-label="Contadores del outbox"><h2 className="text-xl">Cola de sincronización</h2><ul>{['PENDING', 'PROCESSING', 'DONE', 'FAILED', 'SKIPPED'].map(value => <li key={value}>{value}: {counts.find(row => row.status === value)?._count ?? 0}</li>)}</ul></section>
    <div className="flex gap-4"><form action={processNow}><button disabled={!client.enabled}>Procesar ahora</button></form><form action={retryNow}><button>Reintentar fallidos</button></form></div>
    <section aria-label="Últimos errores"><h2 className="text-xl">Últimos errores</h2><ul>{errors.map(error => <li key={error.id}>{error.kind} · {error.entityId} · {error.status} · intentos {error.attempts} · {error.lastError}</li>)}</ul></section>
  </main>;
}
