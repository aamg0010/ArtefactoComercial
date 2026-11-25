import Link from 'next/link';
import { loadContactHistory } from '@/lib/contact-history-service';
import { historyDate, historyMedia } from '@/lib/contact-history';
import { prisma } from '@/lib/prisma';

export async function ContactHistory({ companyId, medium = 'Todos', limit = '25' }: { companyId: string; medium?: string; limit?: string }) {
  const filter = historyMedia.includes(medium as typeof historyMedia[number]) ? medium : 'Todos';
  const entries = await loadContactHistory(prisma, companyId, filter);
  const count = Math.max(25, Math.min(entries.length, Number.parseInt(limit, 10) || 25));
  const icons: Record<string, string> = { Email: '✉', Llamada: '☎', Reunión: '▣', Respuestas: '↩', Cambios: '↻' };
  return <section id="historial" aria-label="Historial de contactos" className="card space-y-4 p-4">
    <h2 className="text-lg font-semibold">Historial de contactos</h2>
    <div className="flex flex-wrap gap-3">{historyMedia.map(m => <Link key={m} aria-current={filter === m ? 'page' : undefined} className={filter === m ? 'badge badge-b' : 'underline'} href={`?medio=${encodeURIComponent(m)}#historial`}>{m}</Link>)}</div>
    <a className="btn-secondary inline-block" href={`/empresas/${companyId}/historial.csv?medio=${encodeURIComponent(filter)}`}>Descargar historial (CSV)</a>
    {!entries.length && <p>No hay contactos registrados para este medio.</p>}
    <ol className="space-y-4 border-l border-slate-200 pl-4">{entries.slice(0, count).map(e => { const d = historyDate(e.at); return <li key={e.id} className="space-y-1 border-b pb-3">
      <p><span aria-hidden="true">{icons[e.medium]}</span> <strong>{e.medium}</strong> · <time dateTime={e.at.toISOString()}>{d.date} {d.time}</time> · por {e.user}</p>
      <p>{e.status}{e.address && ` · ${e.address}`}</p>{e.subject && <p className="font-semibold">{e.subject}</p>}
      {e.medium === 'Email' ? <details><summary>Ver texto completo</summary><p className="whitespace-pre-wrap">{e.text}</p>{e.signature && <p>Firma: {e.signature}</p>}</details> : <p className="whitespace-pre-wrap">{e.text}</p>}
    </li>; })}</ol>
    {entries.length > count && <Link className="underline" href={`?medio=${encodeURIComponent(filter)}&limite=${count + 25}#historial`}>Ver más ({entries.length - count} pendientes)</Link>}
  </section>;
}
