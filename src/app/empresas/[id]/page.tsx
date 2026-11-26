import { companyJobState, isCompanyJobRunning } from '@/lib/jobs/company-jobs';
import { isReusableDraft } from '@/lib/research/scripts';
import { JobRefresh } from './job-refresh';
import { DeleteCompany } from './delete-company';
import { lacksWebsiteResearch } from '@/lib/research/script-context';
import { ContactHistory } from './contact-history';
import { loadContactStatuses } from '@/lib/contact-status-service';
import { ContactBadge, ContactWarning } from '@/app/contact-status';
import { ReplyCards } from '../../pipeline/reply-cards';
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
import { loadGuide } from '@/lib/guia/service';
import Link from 'next/link';

const pendingFor: Record<string, { pendingText: string; notice?: string }> = {
  research: { pendingText: 'Investigando…', notice: 'Iniciando investigación en segundo plano.' },
  generate: { pendingText: 'Generando guion…', notice: 'Iniciando guion en segundo plano.' },
  approve: { pendingText: 'Aprobando…', notice: 'Aprobando el guion y creando las tareas de la cadencia.' },
  priority: { pendingText: 'Aplicando…' },
};

export const dynamic = 'force-dynamic';
const factorLabels: Record<string, string> = { sector: 'Encaje de sector', size: 'Tamaño', intent: 'Intención', contact: 'Accesibilidad del contacto', proximity: 'Proximidad geográfica', crossSell: 'Venta cruzada' };
const fieldLabels: Record<string, string> = { name: 'Nombre', city: 'Municipio', website: 'Web', phone: 'Teléfono corporativo', email: 'Email corporativo' };
const errorMessages: Record<string, string> = {
  CONTACT_CONFIRMATION_REQUIRED: 'Esta empresa está contactada y en espera. Revisa las fechas y marca «Sí, quiero contactarla igualmente» para continuar.',
  CONTACT_BLOCKED: 'Esta empresa está marcada como No contactar o Cliente. No se puede contactar.',
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
export default async function CompanyDetail({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; done?: string; ok?: string; medio?: string; limite?: string } }) {
  const session = await auth();
  const replies = await prisma.emailReply.findMany({ where: { companyId: params.id }, include: { company: true }, orderBy: [{ status: 'asc' }, { receivedAt: 'desc' }] });
  const canEdit = Boolean(session?.user?.id) && session?.user?.role !== 'DIRECTOR';
  const company = await prisma.company.findUnique({ where: { id: params.id }, include: {
    contacts: true, sourceIdentities: true, evidence: { orderBy: { createdAt: 'desc' } }, researchReports: { orderBy: { version: 'desc' }, include: { score: true } }, scripts: { orderBy: { version: 'desc' } },
  } });
  if (!company) notFound();
  const contact = (await loadContactStatuses(prisma, [company.id])).get(company.id)!;
  const guide = session?.user?.id ? await loadGuide(prisma, { userId: session.user.id, role: session.user.role ?? 'SALES', team: true }, new Date(), undefined, company.id) : null;
  const notices = guide?.groups.filter(g => ['overdue', 'next', 'stalled', 'closed', 'reminders'].includes(g.id)).flatMap(g => g.items) ?? [];
  const suppressed = await isSuppressed(prisma, company.id);
  const products = await prisma.product.findMany({ where: { active: true }, orderBy: { line: 'asc' } });
  const latest = company.researchReports.find(report => report.origin === 'AI');
  const score = latest?.score;
  const research = researchShape.safeParse(latest?.data);
  const pendingEmails = company.scripts.some(s => s.status === 'APPROVED') ? await prisma.task.count({ where: { companyId: company.id, type: 'EMAIL', status: 'PENDING', script: { status: 'APPROVED' }, id: { notIn: (await prisma.emailDispatch.findMany({ where: { companyId: company.id }, select: { taskId: true } })).map(d => d.taskId) } } }) : 0;
  const reusableDraft = company.scripts[0] && isReusableDraft(company.scripts[0]);
  const [scriptResult, researchResult] = await Promise.all([
    prisma.auditLog.findFirst({ where: { entityType: 'Company', entityId: company.id, action: { in: ['SCRIPT_GENERATED', 'SCRIPT_GENERATION_FAILED'] } }, orderBy: { createdAt: 'desc' }, select: { action: true, createdAt: true } }),
    prisma.auditLog.findFirst({ where: { entityType: 'Company', entityId: company.id, action: { in: ['RESEARCH_DONE', 'RESEARCH_FAILED'] } }, orderBy: { createdAt: 'desc' }, select: { action: true, createdAt: true } }),
  ]);
  const scriptState = companyJobState('script', isCompanyJobRunning('script', company.id), company.scripts[0]?.createdAt, scriptResult);
  const researchState = companyJobState('research', isCompanyJobRunning('research', company.id), latest?.createdAt, researchResult);
  const actionForm = (action: string, label: string) => <form action={companyAction}><input type="hidden" name="companyId" value={company.id}/><SubmitButton name="action" value={action} disabled={!canEdit || company.acceptanceStatus !== 'ACCEPTED' || (action === 'research' && researchState === 'running')} {...pendingFor[action]}>{label}</SubmitButton></form>;
  return <main className="mx-auto max-w-5xl space-y-5 p-3 [overflow-wrap:anywhere] sm:p-5">
    <JobRefresh active={scriptState === 'running' || researchState === 'running'}/>
    {scriptState === 'running' && <p role="status">Generando guion con IA… suele tardar uno o dos minutos. Puedes seguir trabajando; esta página se actualiza sola.</p>}
    {researchState === 'running' && <p role="status">Investigando… suele tardar uno o dos minutos. Puedes seguir trabajando; esta página se actualiza sola.</p>}
    {scriptState === 'ready' && <p role="status">Guion nuevo listo: revísalo y apruébalo.</p>}
    {researchState === 'ready' && <p role="status">Investigación lista.</p>}
    {(scriptState === 'failed' || researchState === 'failed') && <p role="alert">No se pudo completar la operación. Comprueba la configuración o vuelve a intentarlo. La ejecución de IA queda registrada sin datos personales.</p>}
    <h1 className="page-title break-words">{company.name}</h1>
    <section aria-label="Estado de contacto" className="card p-4"><ContactBadge status={contact} detail/></section>
    {notices.length > 0 && <section aria-label="Avisos de seguimiento" className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h2 className="font-semibold">Guía del día</h2><ul>{notices.map(item => <li key={`${item.id}-${item.title}`}>{item.title} · {item.reason}</li>)}</ul><Link className="underline" href="/mi-dia">Gestionar en Mi día</Link></section>}
    <p>Revisión: {company.acceptanceStatus === 'PENDING' ? 'Pendiente de aceptar' : company.acceptanceStatus === 'DISCARDED' ? 'Descartada' : 'Lista para trabajar'}</p>
    {company.trygestionEmpresaId && <section aria-label="trygestión" className="card flex flex-wrap items-center justify-between gap-3 border-try-100 bg-try-50/60 py-4">
      <p className="font-display text-sm text-try-900"><span className="badge badge-b mr-2">En trygestión</span>Sincronizada con el Pipeline</p>
      <div className="flex flex-wrap gap-2">
        <a className="inline-flex items-center gap-1 rounded-xl bg-try-500 px-3 py-2 font-display text-sm font-medium text-white shadow-sm hover:bg-try-600 hover:text-white" href={trygestionEmpresaUrl(company.trygestionEmpresaId)} target="_blank" rel="noopener noreferrer">Abrir en trygestión ↗</a>
        <a className="inline-flex items-center gap-1 rounded-xl border border-try-200 bg-white px-3 py-2 font-display text-sm font-medium text-try-700 hover:border-try-500" href={trygestionPipelineUrl()} target="_blank" rel="noopener noreferrer">Pipeline de trygestión ↗</a>
      </div>
    </section>}
    <section aria-label="Respuestas recibidas" className="card p-4"><h2 className="text-lg font-semibold">Respuestas recibidas</h2><ReplyCards replies={replies} canEdit={canEdit}/>{!replies.length && <p>No hay respuestas recibidas.</p>}</section>
    <ContactHistory companyId={company.id} medium={searchParams.medio} limit={searchParams.limite}/>
    <PlacesView companyId={company.id} country={company.country}/>
    {searchParams.error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-900">{errorMessages[searchParams.error] ?? 'No se pudo completar la operación. Comprueba la configuración o vuelve a intentarlo. La ejecución de IA queda registrada sin datos personales.'}</p>}
    {(searchParams.done || (searchParams.ok && !['generando', 'investigando'].includes(searchParams.ok))) && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-900">{okMessages[searchParams.ok ?? ''] ?? 'Operación completada.'}</p>}
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
      <p className="text-sm text-slate-600">Al enviar desde Mi día se añaden la firma con teléfono y web y el pie de BAJA.</p>
      {(company.website || company.normalizedDomain) && (!research.success || lacksWebsiteResearch(company.website ?? company.normalizedDomain, research.data)) && <div className="my-3 rounded border border-amber-300 p-3"><p>Ficha sin datos de su web: actualiza la investigación para un guion más personalizado</p>{canEdit && actionForm('research', 'Actualizar investigación')}</div>}
      {pendingEmails > 0 && <p>Actualizar textos de los emails pendientes: regenere el guion, revise el borrador y confirme debajo la sustitución. Se conservan las fechas y la cadencia.</p>}
      {canEdit && company.acceptanceStatus === 'ACCEPTED' && research.success && <form action={companyAction}>
        <input type="hidden" name="companyId" value={company.id}/><label>Línea de producto principal<select name="product" defaultValue={research.data.recommendations[0].line}>{products.map(product => <option key={product.id} value={product.line}>{product.line}</option>)}</select></label>
        <ContactWarning status={contact}/><SubmitButton disabled={contact.color === 'gray' || scriptState === 'running' || reusableDraft} name="action" value="generate" {...pendingFor.generate}>{reusableDraft ? 'Ya hay un borrador nuevo para revisar' : company.scripts.length ? 'Regenerar guion' : 'Generar guion'}</SubmitButton>

      </form>}
      {company.scripts.map(script => <details open={(script.id === company.scripts[0].id && isReusableDraft(script)) || script.status === 'APPROVED'} key={script.id}><summary>Guion versión {script.version} · {script.status}</summary><article className="mt-4 border-t pt-3">
        <h3 className="font-semibold">Guion versión {script.version} · {script.author} · {script.status === 'BORRADOR' ? 'BORRADOR' : 'Aprobado'}</h3>
        {canEdit && pendingEmails > 0 && isReusableDraft(script) && script.id === company.scripts[0].id && <form action={companyAction} className="my-3 border p-3"><input type="hidden" name="companyId" value={company.id}/><input type="hidden" name="scriptId" value={script.id}/><label className="block"><input type="checkbox" name="confirmUpdate" required/> He revisado este borrador y confirmo sustituir solo los textos de los emails pendientes sin intento de envío.</label><ContactWarning status={contact}/><SubmitButton disabled={contact.color === 'gray'} name="action" value="update-emails" pendingText="Actualizando…">Actualizar textos de los emails pendientes</SubmitButton></form>}
        <ScriptView content={script.content as GeneratedScript} emailAction={index => suppressed ? <p>La empresa ha solicitado la baja y no puede recibir emails.</p> : script.status === 'BORRADOR' ? <p>Aprueba el guion para poder enviar sus emails</p> : company.acceptanceStatus !== 'ACCEPTED' ? <p>Acepta la empresa para poder enviar sus emails.</p> : canEdit ? <form action={prepareEmail} className="mt-2"><input type="hidden" name="companyId" value={company.id}/><input type="hidden" name="scriptId" value={script.id}/><input type="hidden" name="emailIndex" value={index}/><ContactWarning status={contact}/><SubmitButton disabled={contact.color === 'gray'} className="btn-secondary" pendingText="Preparando…">Enviar desde Mi día</SubmitButton></form> : null}/>
        {canEdit && script.status === 'BORRADOR' && script.version === company.scripts[0].version && <form action={companyAction}><input type="hidden" name="companyId" value={company.id}/><input type="hidden" name="scriptId" value={script.id}/><SubmitButton name="action" value="approve" {...pendingFor.approve}>Aprobar guion</SubmitButton></form>}
      </article></details>)}
    </section>
    <section aria-label="Datos confirmados" className="card p-4"><h2 className="font-semibold">Datos confirmados y procedencia</h2>{company.evidence.map(item => {
      const data = item.data as { confirmed?: Record<string, string>; provenance?: Record<string, { kind: string; url?: string; date: string }> };
      return <details key={item.id}><summary>{item.kind === 'WEB_OWN' ? 'Web propia y revisión humana' : 'Confirmado manualmente'} · {item.createdAt.toISOString().slice(0, 10)}</summary><dl>{Object.entries(data.confirmed ?? {}).filter(([, value]) => value).map(([field, value]) => {
        const source = data.provenance?.[field];
        return <div className="mt-2" key={field}><dt className="font-semibold">{fieldLabels[field] ?? field}</dt><dd>{String(value)} · {source?.kind ?? 'Confirmado manualmente'} {source?.url && <a className="font-medium hover:underline" href={source.url} target="_blank" rel="noreferrer">{source.url}</a>} · {source?.date.slice(0, 10)}</dd></div>;
      })}</dl></details>;
    })}</section>
    {canEdit && <DeleteCompany companyId={company.id}/>}
  </main>;
}
