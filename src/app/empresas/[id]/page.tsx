import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { companyAction } from './actions';
import { researchShape } from '@/lib/research/schema';
import { ScriptView } from '../../mi-dia/script-view';
import type { GeneratedScript } from '@/lib/research/scripts';
import { isVerifiedDirectContact } from '@/lib/company-contact';

export const dynamic = 'force-dynamic';
const factorLabels: Record<string, string> = { sector: 'Encaje de sector', size: 'Tamaño', intent: 'Intención', contact: 'Accesibilidad del contacto', proximity: 'Proximidad geográfica', crossSell: 'Venta cruzada' };
export default async function CompanyDetail({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; done?: string } }) {
  const company = await prisma.company.findUnique({ where: { id: params.id }, include: {
    contacts: true, researchReports: { orderBy: { version: 'desc' }, include: { score: true } }, scripts: { orderBy: { version: 'desc' } },
  } });
  if (!company) notFound();
  const products = await prisma.product.findMany({ where: { active: true }, orderBy: { line: 'asc' } });
  const latest = company.researchReports.find(report => report.origin === 'AI');
  const score = latest?.score;
  const research = researchShape.safeParse(latest?.data);
  const actionForm = (action: string, label: string) => <form action={companyAction}><input type="hidden" name="companyId" value={company.id}/><button name="action" value={action}>{label}</button></form>;
  return <main className="mx-auto max-w-5xl space-y-6 p-5">
    <h1 className="text-2xl font-bold">{company.name}</h1>
    {searchParams.error && <p role="alert">No se pudo completar la operación. Comprueba la configuración o vuelve a intentarlo. La ejecución de IA queda registrada sin datos personales.</p>}
    {searchParams.done && <p role="status">Operación completada.</p>}
    <section aria-label="Datos de empresa" className="rounded bg-white p-4">
      <h2 className="text-lg font-semibold">Datos de empresa</h2>
      <p>{company.sector ?? 'Sector pendiente'} · {company.city} · {company.comarca} · {company.region} · {company.country}</p>
      <p>Web: {company.website ?? company.normalizedDomain ?? 'Sin web registrada'}</p>
      <p>Prioridad actual: {company.priority ?? 'Sin asignar'}</p>
      <p>Próxima acción: {company.nextAction ?? 'Por definir'}</p>
      <ul>{company.contacts.map(contact => <li key={contact.id}>{contact.fullName} · {contact.email?.trim() || contact.phone?.trim() || 'Sin canal de contacto directo'} · {isVerifiedDirectContact(contact) ? 'Verificado' : 'Pendiente de verificar'}</li>)}</ul>
      {actionForm('research', 'Investigar')}
    </section>
    <section aria-label="Puntuación" className="rounded bg-white p-4">
      <h2 className="text-lg font-semibold">Puntuación</h2>
      {score ? <><p>Puntuación: {score.total}/100 · Prioridad sugerida: {score.suggestedPriority} · Actual: {company.priority ?? 'Sin asignar'}</p>
        <ul>{(score.breakdown as { factor: string; value: number; weight: number; points: number; reason: string }[]).map(item => <li key={item.factor}>{factorLabels[item.factor]}: {item.points} puntos (factor {item.value}, peso {item.weight}) — {item.factor === 'contact' && item.value === 0 ? 'Sin canal de contacto directo' : item.reason}</li>)}</ul>
        {actionForm('priority', 'Aplicar prioridad sugerida')}</> : <p>Investiga la empresa para calcular su puntuación.</p>}
    </section>
    <section aria-label="Investigación" className="rounded bg-white p-4">
      <h2 className="text-lg font-semibold">Ficha de investigación</h2>
      {research.success ? <>
        <p>Versión {latest!.version} · {research.data.webNote}</p>
        {[
          ['Resumen', research.data.summary], ['Actividad', research.data.activity], ['Tamaño', research.data.size], ['Ubicación', research.data.location], ['Rol del decisor', research.data.decisionMakerRole],
          ...research.data.signals.map(item => ['Señal de oportunidad', item] as const), ...research.data.pains.map(item => ['Dolor probable', item] as const),
          ...research.data.recommendations.map(item => [`Línea: ${item.line}`, item.reason] as const),
        ].map(([label, item], index) => typeof item === 'object' && <p key={index}><b>{String(label)}:</b> {item.text} <em>({item.status})</em> {item.sources.map(id => <a className="ml-1 underline" href={`#source-${id}`} key={id}>[{id}]</a>)}</p>)}
        <h3 className="mt-3 font-semibold">Fuentes</h3><ul>{research.data.sources.map(source => <li id={`source-${source.id}`} key={source.id}>
          {source.url.startsWith('http') ? <a className="underline" href={source.url} target="_blank" rel="noreferrer">{source.url}</a> : 'Datos registrados en el CRM'} · {source.date.slice(0, 10)}
        </li>)}</ul>
      </> : <p>No hay ficha de IA todavía.</p>}
      <details><summary>Historial de investigación ({company.researchReports.length})</summary>{company.researchReports.map(report => <article key={report.id}><h3>Versión {report.version} · {report.origin}</h3><p>{report.summary}</p></article>)}</details>
    </section>
    <section aria-label="Guiones" className="rounded bg-white p-4">
      <h2 className="text-lg font-semibold">Guiones</h2>
      {research.success && !company.scripts.some(script => script.status === 'APPROVED') && <form action={companyAction}>
        <input type="hidden" name="companyId" value={company.id}/><label>Línea de producto principal<select name="product" defaultValue={research.data.recommendations[0].line}>{products.map(product => <option key={product.id} value={product.line}>{product.line}</option>)}</select></label>
        <button name="action" value="generate">Generar guion</button>
      </form>}
      {company.scripts.map(script => <article className="mt-4 border-t pt-3" key={script.id}>
        <h3 className="font-semibold">Guion versión {script.version} · {script.author} · {script.status === 'BORRADOR' ? 'BORRADOR' : 'Aprobado'}</h3>
        <ScriptView content={script.content as GeneratedScript}/>
        {script.status === 'BORRADOR' && script.version === company.scripts[0].version && <form action={companyAction}><input type="hidden" name="companyId" value={company.id}/><input type="hidden" name="scriptId" value={script.id}/><button name="action" value="approve">Aprobar guion</button></form>}
      </article>)}
    </section>
  </main>;
}
