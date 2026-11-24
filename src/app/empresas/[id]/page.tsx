import { trygestionEmpresaUrl, trygestionPipelineUrl } from '@/lib/trygestion/links';
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { companyAction } from './actions';
import { researchShape } from '@/lib/research/schema';
import { ScriptView } from '../../mi-dia/script-view';
import type { GeneratedScript } from '@/lib/research/scripts';
import { auth } from '@/auth';
import { PlacesView } from './places-view';
import { CompanyContact } from './company-contact';
import { SubmitButton } from '../../submit-button';
import { prepareEmail } from './email-actions';
import { isSuppressed } from '@/lib/suppression';

const pendingFor: Record<string, { pendingText: string; notice?: string }> = {
  research: { pendingText: 'Investigando…', notice: 'Investigando la empresa (su web y fuentes públicas). Puede tardar unos minutos: no cierres ni recargues la página.' },
  generate: { pendingText: 'Generando guion…', notice: 'La IA está escribiendo el guion de llamada y los emails. Puede tardar hasta un par de minutos: no cierres ni recargues la página.' },
  approve: { pendingText: 'Aprobando…', notice: 'Aprobando el guion y creando las tareas de la cadencia.' },
  priority: { pendingText: 'Aplicando…' },
};

export const dynamic = 'force-dynamic';
const factorLabels: Record<string, string> = { sector: 'Encaje de sector', size: 'Tamaño', intent: 'Intención', contact: 'Accesibilidad del contacto', proximity: 'Proximidad geográfica', crossSell: 'Venta cruzada' };
const fieldLabels: Record<string, string> = { name: 'Nombre', city: 'Municipio', website: 'Web', phone: 'Teléfono corporativo', email: 'Email corporativo' };
const errorMessages: Record<string, string> = {
  'email-no-preparado': 'No se pudo preparar el email. Comprueba que la empresa esté aceptada, sin baja y el guion aprobado.',
  'contacto-duplicado': 'Ese contacto ya existe en esta empresa (mismo nombre, email o teléfono). No se ha creado otra vez.',
  'contacto-invalido': 'Revisa el contacto: el nombre es obligatorio y, si pones email, tiene que ser válido.',
  'contacto-no-encontrado': 'Ese contacto ya no existe (quizá lo borró otra persona).',
  'empresa-invalida': 'Revisa los datos de la empresa: el email tiene que ser válido.',
  'nif-duplicado': 'Ese NIF/NIT ya pertenece a otra empresa de la base.',
};
const okMessages: Record<string, string> = {
  'contacto-anadido': 'Contacto añadido.', 'contacto-borrado': 'Contacto borrado (también se borrará en trygestión).',
  consentimiento: 'Consentimiento actualizado.', 'empresa-guardada': 'Datos de la empresa guardados.',
};
export default async function CompanyDetail({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; done?: string; ok?: string } }) {
  const session = await auth();
  const canEdit = Boolean(session?.user?.id) && session?.user?.role !== 'DIRECTOR';
  const company = await prisma.company.findUnique({ where: { id: params.id }, include: {
    contacts: true, sourceIdentities: true, evidence: { orderBy: { createdAt: 'desc' } }, researchReports: { orderBy: { version: 'desc' }, include: { score: true } }, scripts: { orderBy: { version: 'desc' } },
  } });
  if (!company) notFound();
  const suppressed = await isSuppressed(prisma, company.id);
  const products = await prisma.product.findMany({ where: { active: true }, orderBy: { line: 'asc' } });
  const latest = company.researchReports.find(report => report.origin === 'AI');
  const score = latest?.score;
  const research = researchShape.safeParse(latest?.data);
  const actionForm = (action: string, label: string) => <form action={companyAction}><input type="hidden" name="companyId" value={company.id}/><SubmitButton name="action" value={action} disabled={company.acceptanceStatus !== 'ACCEPTED'} {...pendingFor[action]}>{label}</SubmitButton></form>;
  return <main className="mx-auto max-w-5xl space-y-5 p-3 [overflow-wrap:anywhere] sm:p-5">
    <h1 className="page-title break-words">{company.name}</h1>
    <p>Revisión: {company.acceptanceStatus === 'PENDING' ? 'Pendiente de aceptar' : company.acceptanceStatus === 'DISCARDED' ? 'Descartada' : 'Lista para trabajar'}</p>
    {company.trygestionEmpresaId && <section aria-label="trygestión" className="card flex flex-wrap items-center justify-between gap-3 border-try-100 bg-try-50/60 py-4">
      <p className="font-display text-sm text-try-900"><span className="badge badge-b mr-2">En trygestión</span>Sincronizada con el Pipeline</p>
      <div className="flex flex-wrap gap-2">
        <a className="inline-flex items-center gap-1 rounded-xl bg-try-500 px-3 py-2 font-display text-sm font-medium text-white shadow-sm hover:bg-try-600 hover:text-white" href={trygestionEmpresaUrl(company.trygestionEmpresaId)} target="_blank" rel="noopener noreferrer">Abrir en trygestión ↗</a>
        <a className="inline-flex items-center gap-1 rounded-xl border border-try-200 bg-white px-3 py-2 font-display text-sm font-medium text-try-700 hover:border-try-500" href={trygestionPipelineUrl()} target="_blank" rel="noopener noreferrer">Pipeline de trygestión ↗</a>
      </div>
    </section>}
    <PlacesView companyId={company.id} country={company.country}/>
    {searchParams.error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-900">{errorMessages[searchParams.error] ?? 'No se pudo completar la operación. Comprueba la configuración o vuelve a intentarlo. La ejecución de IA queda registrada sin datos personales.'}</p>}
    {(searchParams.done || searchParams.ok) && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-900">{okMessages[searchParams.ok ?? ''] ?? 'Operación completada.'}</p>}
    <section aria-label="Datos de empresa" className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Datos de empresa</h2>
        {actionForm('research', 'Investigar')}
      </div>
      <CompanyContact company={company} contacts={company.contacts} sources={company.sourceIdentities} editable={canEdit && company.acceptanceStatus !== 'DISCARDED'}/>
    </section>
    <section aria-label="Puntuación" className="card p-4">
      <h2 className="text-lg font-semibold">Puntuación</h2>
      {score ? <><p>Puntuación: {score.total}/100 · Prioridad sugerida: {score.suggestedPriority} · Actual: {company.priority ?? 'Sin asignar'}</p>
        <ul>{(score.breakdown as { factor: string; value: number; weight: number; points: number; reason: string }[]).map(item => <li key={item.factor}>{factorLabels[item.factor]}: {item.points} puntos (factor {item.value}, peso {item.weight}) — {item.factor === 'contact' && item.value === 0 ? 'Sin canal de contacto directo' : item.reason}</li>)}</ul>
        {actionForm('priority', 'Aplicar prioridad sugerida')}</> : <p>Investiga la empresa para calcular su puntuación.</p>}
    </section>
    <section aria-label="Investigación" className="card p-4">
      <h2 className="text-lg font-semibold">Ficha de investigación</h2>
      {research.success ? <>
        <p>Versión {latest!.version} · {research.data.webNote}</p>
        {[
          ['Resumen', research.data.summary], ['Actividad', research.data.activity], ['Tamaño', research.data.size], ['Ubicación', research.data.location], ['Rol del decisor', research.data.decisionMakerRole],
          ...research.data.signals.map(item => ['Señal de oportunidad', item] as const), ...research.data.pains.map(item => ['Dolor probable', item] as const),
          ...research.data.recommendations.map(item => [`Línea: ${item.line}`, item.reason] as const),
        ].map(([label, item], index) => typeof item === 'object' && <p key={index}><b>{String(label)}:</b> {item.text} <em>({item.status})</em> {item.sources.map(id => <a className="ml-1 underline" href={`#source-${id}`} key={id}>[{id}]</a>)}</p>)}
        <h3 className="mt-3 font-semibold">Fuentes</h3><ul>{research.data.sources.map(source => <li id={`source-${source.id}`} key={source.id}>
          {source.url.startsWith('http') ? <a className="font-medium hover:underline" href={source.url} target="_blank" rel="noreferrer">{source.url}</a> : 'Datos registrados en el CRM'} · {source.date.slice(0, 10)}
        </li>)}</ul>
      </> : <p>No hay ficha de IA todavía.</p>}
      <details><summary>Historial de investigación ({company.researchReports.length})</summary>{company.researchReports.map(report => <article key={report.id}><h3>Versión {report.version} · {report.origin}</h3><p>{report.summary}</p></article>)}</details>
    </section>
    <section aria-label="Guiones" className="card p-4">
      <h2 className="text-lg font-semibold">Guiones</h2>
      {company.acceptanceStatus === 'ACCEPTED' && research.success && !company.scripts.some(script => script.status === 'APPROVED') && <form action={companyAction}>
        <input type="hidden" name="companyId" value={company.id}/><label>Línea de producto principal<select name="product" defaultValue={research.data.recommendations[0].line}>{products.map(product => <option key={product.id} value={product.line}>{product.line}</option>)}</select></label>
        <SubmitButton name="action" value="generate" {...pendingFor.generate}>Generar guion</SubmitButton>
      </form>}
      {company.scripts.map(script => <article className="mt-4 border-t pt-3" key={script.id}>
        <h3 className="font-semibold">Guion versión {script.version} · {script.author} · {script.status === 'BORRADOR' ? 'BORRADOR' : 'Aprobado'}</h3>
        <ScriptView content={script.content as GeneratedScript} emailAction={index => suppressed ? <p>La empresa ha solicitado la baja y no puede recibir emails.</p> : script.status === 'BORRADOR' ? <p>Aprueba el guion para poder enviar sus emails</p> : company.acceptanceStatus !== 'ACCEPTED' ? <p>Acepta la empresa para poder enviar sus emails.</p> : canEdit ? <form action={prepareEmail} className="mt-2"><input type="hidden" name="companyId" value={company.id}/><input type="hidden" name="scriptId" value={script.id}/><input type="hidden" name="emailIndex" value={index}/><SubmitButton className="btn-secondary" pendingText="Preparando…">Enviar desde Mi día</SubmitButton></form> : null}/>
        {script.status === 'BORRADOR' && script.version === company.scripts[0].version && <form action={companyAction}><input type="hidden" name="companyId" value={company.id}/><input type="hidden" name="scriptId" value={script.id}/><SubmitButton name="action" value="approve" {...pendingFor.approve}>Aprobar guion</SubmitButton></form>}
      </article>)}
    </section>
    <section aria-label="Datos confirmados" className="card p-4"><h2 className="font-semibold">Datos confirmados y procedencia</h2>{company.evidence.map(item => {
      const data = item.data as { confirmed?: Record<string, string>; provenance?: Record<string, { kind: string; url?: string; date: string }> };
      return <details key={item.id}><summary>{item.kind === 'WEB_OWN' ? 'Web propia y revisión humana' : 'Confirmado manualmente'} · {item.createdAt.toISOString().slice(0, 10)}</summary><dl>{Object.entries(data.confirmed ?? {}).filter(([, value]) => value).map(([field, value]) => {
        const source = data.provenance?.[field];
        return <div className="mt-2" key={field}><dt className="font-semibold">{fieldLabels[field] ?? field}</dt><dd>{String(value)} · {source?.kind ?? 'Confirmado manualmente'} {source?.url && <a className="font-medium hover:underline" href={source.url} target="_blank" rel="noreferrer">{source.url}</a>} · {source?.date.slice(0, 10)}</dd></div>;
      })}</dl></details>;
    })}</section>
  </main>;
}
