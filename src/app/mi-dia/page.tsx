import { loadContactStatuses } from '@/lib/contact-status-service';
import { prisma } from '@/lib/prisma';
import { recordTaskResult } from './actions';
import { taskDate } from '@/lib/dates';
import { ScriptView } from './script-view';
import Link from 'next/link';
import { EmailApproval } from './email-approval';
import { trygestionConfiguration } from '@/lib/trygestion/client';
import { auth } from '@/auth';
import { SubmitButton } from '../submit-button';
import { filtersSchema, filterTasks, productLines, taskTypeLabels, validDay } from '@/lib/mi-dia/filters';
import { safeId, taskEmail, defaultSignature } from '@/lib/mi-dia/script-email';
import { TaskFocus } from './task-focus';
import { loadGuide } from '@/lib/guia/service';
import { DayGuide } from './day-guide';
import { companyInScope, taskInScope } from '@/lib/guia/engine';
import { redirect } from 'next/navigation';

const emailErrors: Record<string, string> = {
  CONTACT_CONFIRMATION_REQUIRED: 'empresa contactada en espera. Revisa las fechas y confirma expresamente si quieres adelantar el contacto.',
  CONTACT_BLOCKED: 'esta empresa está marcada como No contactar o Cliente.',
  EMAIL_RECIPIENT_NOT_COMPANY_CONTACT: 'el destinatario no es el email de la empresa ni de uno de sus contactos.',
  EMAIL_RESOLVE_VARIABLES: 'sustituye [TELÉFONO] y [WEB] en el texto.',
  COMPANY_SUPPRESSED: 'la empresa pidió la baja.',
  EMAIL_CONSENT_REQUIRED: 'el contacto necesita consentimiento antes de recibir emails.',
  EMAIL_CONTENT_CHANGED: 'este email ya se intentó enviar con otro texto.',
  EMAIL_IN_PROGRESS: 'el envío ya está en curso; espera un par de minutos.',
  EMAIL_REVIEW_REQUIRED: 'revisa los campos y marca la casilla de aprobación.',
  EMAIL_SEND_ERROR: 'trygestión no pudo enviarlo; inténtalo de nuevo.',
  EMAIL_COPY_ONLY: 'el envío por trygestión no está activado.',
};
const results = ['Contactado', 'No contesta', 'Buzón', 'Interesado', 'Reunión agendada', 'No interesado', 'Baja'];
type Content = Parameters<typeof ScriptView>[0]['content'];

export default async function MyDay({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const day = validDay(searchParams.fecha);
  let filters = filtersSchema.parse(searchParams);
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const scope = { userId: session.user.id, role: session.user.role ?? 'SALES', team: searchParams.equipo !== '0' };
  const guide = await loadGuide(prisma, scope, new Date(), day);
  const me = session?.user?.id ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true, signatureName: true, signatureTitle: true } }) : null;
  const firma = defaultSignature(me);
  const limite = new Date(`${day}T23:59:59.999Z`); limite.setUTCDate(limite.getUTCDate() + 7);
  const include = { company: { include: { contacts: true, opportunities: { include: { product: true } } } }, script: true, cadenceStep: true } as const;
  const candidates = (await prisma.task.findMany({ where: { status: 'PENDING', company: { acceptanceStatus: 'ACCEPTED' }, OR: [{ dueAt: { lte: limite } }, { dueAt: null }] }, include })).filter(task => (companyInScope(task.company, scope) || task.assigneeId === scope.userId) && taskInScope(task, scope));
  const requested = safeId.safeParse(searchParams.tarea);
  const target = requested.success ? await prisma.task.findUnique({ where: { id: requested.data }, include }) : null;
  const statuses = await loadContactStatuses(prisma, [...new Set([...candidates.map(t => t.companyId), ...(target ? [target.companyId] : [])])]);
  const all = candidates.filter(task => statuses.get(task.companyId)?.color !== 'gray');
  const products = [...new Set(all.flatMap(productLines))].sort((a, b) => a.localeCompare(b, 'es'));
  if (filters.producto && !products.includes(filters.producto)) filters = { ...filters, producto: '' };
  const focused = target && (companyInScope(target.company, scope) || target.assigneeId === scope.userId) && taskInScope(target, scope) && target.status === 'PENDING' && target.type === 'EMAIL' && target.company.acceptanceStatus === 'ACCEPTED' && target.script?.status === 'APPROVED' && taskEmail(target) && statuses.get(target.companyId)?.color !== 'gray' ? target : null;
  const filtered = filterTasks(all, filters, day);
  const regular = filtered.filter(task => task.id !== focused?.id);
  const today = regular.filter(task => taskDate(task.dueAt) === day);
  const overdue = regular.filter(task => task.dueAt && taskDate(task.dueAt)! < day);
  const upcoming = regular.filter(task => task.dueAt && taskDate(task.dueAt)! > day);
  const planning = regular.filter(task => !task.dueAt);
  const enabled = process.env.EMAIL_TRANSPORT === 'trygestion' && trygestionConfiguration().enabled;
  const canEdit = Boolean(session?.user?.id) && session?.user?.role !== 'DIRECTOR';
  const section = (title: string, tasks: typeof all) => <section aria-label={title} className="mb-8"><h2 className="text-lg font-semibold">{title} ({tasks.length})</h2><div className="mt-3 space-y-4">{tasks.map(task => {
    const selected = task.id === focused?.id;
    const email = taskEmail(task);
    return <article id={`tarea-${task.id}`} key={task.id} className={`card scroll-mt-4 p-4 ${selected ? 'border-try-500 ring-2 ring-try-500' : ''}`}>
      {selected && <p role="status" className="mb-2 font-semibold">Email preparado desde la ficha de {task.company.name}</p>}
      <h3 className="font-semibold"><Link className="font-medium hover:underline" href={`/empresas/${task.companyId}`}><span className={`badge badge-${(task.company.priority ?? 'C').toLowerCase()} mr-2 align-middle`}>{task.company.priority ?? 'Sin prioridad'}</span>{task.company.name}</Link></h3>
      {task.result && <p className="whitespace-pre-wrap text-sm text-slate-600">{task.result}</p>}<p>{task.title}{task.dueAt && taskDate(task.dueAt)! > day && <span className="text-slate-500"> · para el {taskDate(task.dueAt)!.split('-').reverse().join('/')}</span>}</p>
      {task.script && <details className="mt-2"><summary>Guion y emails</summary><ScriptView content={task.script.content as Content}/></details>}
      {canEdit && task.type === 'EMAIL' && task.script?.status === 'APPROVED' && email && (enabled || selected) && <EmailApproval contacts={task.company.contacts} status={statuses.get(task.companyId)!} taskId={task.id} fecha={day} to={task.company.email ?? task.company.contacts.find(contact => contact.email)?.email ?? ''} email={email} firma={firma} open={selected} enabled={enabled}/>}
      {canEdit && <form action={recordTaskResult} className="mt-3 flex flex-wrap gap-2"><input type="hidden" name="taskId" value={task.id}/><label>Notas<textarea name="notes" maxLength={2000}/></label><label>Con quién se habló<input name="interlocutor" maxLength={200}/></label><fieldset className="w-full"><legend>Reunión: fecha y hora (zona del calendario)</legend><label>Fecha<input type="date" name="meetingDate"/></label><label>Hora<input type="time" name="meetingTime"/></label><label>Ubicación<input name="meetingLocation"/></label></fieldset>{results.map(result => <SubmitButton key={result} name="result" value={result} pendingText="Guardando…">{result}</SubmitButton>)}</form>}
    </article>;
  })}</div></section>;
  return <main className="mx-auto max-w-5xl p-3 [overflow-wrap:anywhere] sm:p-5"><h1 className="page-title">Mi día</h1>
    {<form method="get" className="my-3 flex flex-wrap items-end gap-2"><input type="hidden" name="fecha" value={day}/><label>Alcance<select name="equipo" defaultValue={scope.team ? '1' : '0'}><option value="1">Todo el equipo</option><option value="0">Solo lo mío (mis empresas y tareas)</option></select></label><SubmitButton pendingText="Cargando…">Ver guía</SubmitButton></form>}
    <DayGuide guide={guide} canEdit={canEdit}/>
    {guide.groups[0].count > 0 && <p className="my-3"><Link className="underline" href="/pipeline">Ver en el Pipeline</Link></p>}
    <form method="get" className="card my-4 grid min-w-0 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      {!scope.team && <input type="hidden" name="equipo" value="0"/>}
      <label className="min-w-0">Fecha<input className="w-full min-w-0" name="fecha" type="date" defaultValue={day}/></label>
      <label className="min-w-0">Buscar<input className="w-full min-w-0" name="buscar" defaultValue={filters.buscar} placeholder="Empresa, tarea, municipio o región"/></label>
      <label>Tipo de tarea<select name="tipo" defaultValue={filters.tipo}><option value="">Todas</option>{Object.entries(taskTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Prioridad de la empresa<select name="prioridad" defaultValue={filters.prioridad}><option value="">Todas</option>{['A', 'B', 'C'].map(p => <option key={p}>{p}</option>)}<option value="NONE">Sin prioridad</option></select></label>
      <label>País<select name="pais" defaultValue={filters.pais}><option value="">Todos</option><option value="ES">España</option><option value="CO">Colombia</option></select></label>
      <label>Línea de producto<select name="producto" defaultValue={filters.producto}><option value="">Todas</option>{products.map(p => <option key={p}>{p}</option>)}</select></label>
      <label>Mostrar<select name="mostrar" defaultValue={filters.mostrar}><option value="">Todo</option><option value="overdue">Vencidas</option><option value="today">Hoy</option><option value="upcoming">Próximos 7 días</option><option value="undated">Sin fecha</option></select></label>
      <label>Ordenar por<select name="orden" defaultValue={filters.orden}><option value="date">Fecha</option><option value="priority">Prioridad</option><option value="company">Empresa (A-Z)</option></select></label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4"><SubmitButton pendingText="Filtrando…">Ver tareas</SubmitButton><Link className="btn-secondary" href={`/mi-dia?fecha=${day}${scope.team ? '' : '&equipo=0'}`}>Quitar filtros</Link></div>
    </form>
    <p role="status" data-testid="task-count" className="mb-4">{filtered.length} de {all.length} tareas</p>
    {typeof searchParams.email === 'string' && <p role="status">{searchParams.email === 'EMAIL_SENT' ? 'Email enviado.' : `Email no enviado: ${emailErrors[searchParams.email] ?? 'Revisa el envío e inténtalo de nuevo.'}`}</p>}
    {searchParams.tarea && !focused && <p role="alert">La tarea solicitada no existe, ya está hecha o no está disponible para preparar un email.</p>}
    {focused && <><TaskFocus taskId={focused.id}/>{section('Email preparado', [focused])}<p className="mb-4 text-sm text-slate-600">El email seleccionado se muestra arriba aunque no coincida con los filtros. El contador corresponde a las tareas filtradas.</p></>}
    {!filtered.length && <p>No hay tareas que coincidan con los filtros para esta fecha.</p>}
    {section('Hoy', today)}{section('Atrasadas', overdue)}{section('Próximos 7 días', upcoming)}{section('Por planificar', planning)}
  </main>;
}
