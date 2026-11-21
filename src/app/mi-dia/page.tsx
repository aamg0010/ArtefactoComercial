import { prisma } from '@/lib/prisma';
import { recordTaskResult } from './actions';
import { madridDate, taskDate } from '@/lib/dates';
import { ScriptView } from './script-view';
import Link from 'next/link';
import { EmailApproval } from './email-approval';
import { trygestionConfiguration } from '@/lib/trygestion/client';
import { auth } from '@/auth';

const emailErrors: Record<string, string> = {
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
type Content = { llamada?: { apertura?: string; motivo?: string; pregunta_clave?: string; propuesta_valor?: string; objeciones?: Record<string, string>; cierre?: string; mensaje_voz?: string }; emails?: { dia: number; asunto: string; cuerpo: string }[] };

export default async function MyDay({ searchParams }: { searchParams: { fecha?: string; email?: string } }) {
  const day = searchParams.fecha ?? madridDate();
  const session = await auth();
  const me = session?.user?.id ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true, signatureName: true, signatureTitle: true } }) : null;
  const firma = { nombre: me?.signatureName ?? me?.name ?? '', cargo: me?.signatureTitle ?? '' };
  const limite = new Date(`${day}T23:59:59.999Z`); limite.setUTCDate(limite.getUTCDate() + 7);
  const all = await prisma.task.findMany({ where: { status: 'PENDING', company: { acceptanceStatus: 'ACCEPTED' }, OR: [{ dueAt: { lte: limite } }, { dueAt: null }] }, include: { company: { include: { contacts: true } }, script: true, cadenceStep: true }, orderBy: [{ company: { priority: 'asc' } }, { dueAt: 'asc' }] });
  const today = all.filter((task) => taskDate(task.dueAt) === day);
  const overdue = all.filter((task) => task.dueAt && taskDate(task.dueAt)! < day);
  const upcoming = all.filter((task) => task.dueAt && taskDate(task.dueAt)! > day);
  const planning = all.filter((task) => !task.dueAt);
  const section = (title: string, tasks: typeof all) => <section aria-label={title} className="mb-8"><h2 className="text-lg font-semibold">{title} ({tasks.length})</h2><div className="mt-3 space-y-4">{tasks.map((task) => <article key={task.id} className="card p-4"><h3 className="font-semibold"><Link className="font-medium hover:underline" href={`/empresas/${task.companyId}`}><span className={`badge badge-${(task.company.priority ?? 'C').toLowerCase()} mr-2 align-middle`}>{task.company.priority ?? 'C'}</span>{task.company.name}</Link></h3><p>{task.title}{task.dueAt && taskDate(task.dueAt)! > day && <span className="text-slate-500"> · para el {taskDate(task.dueAt)!.split('-').reverse().join('/')}</span>}</p>{task.script && <details className="mt-2"><summary>Guion y emails</summary><ScriptView content={task.script.content as Content}/></details>}{process.env.EMAIL_TRANSPORT === 'trygestion' && trygestionConfiguration().enabled && task.type === 'EMAIL' && task.script && (task.script.content as Content).emails?.filter(email => email.dia === task.cadenceStep?.dayOffset).map(email => <EmailApproval key={email.dia} taskId={task.id} fecha={day} to={task.company.email ?? task.company.contacts.find(contact => contact.email)?.email ?? ''} email={email} firma={firma}/>)}<form action={recordTaskResult} className="mt-3 flex flex-wrap gap-2"><input type="hidden" name="taskId" value={task.id}/><fieldset className="w-full"><legend>Reunión: fecha y hora (zona del calendario)</legend><label>Fecha<input type="date" name="meetingDate"/></label><label>Hora<input type="time" name="meetingTime"/></label><label>Ubicación<input name="meetingLocation"/></label></fieldset>{results.map((result) => <button key={result} name="result" value={result}>{result}</button>)}</form></article>)}</div></section>;
  return <main className="mx-auto max-w-4xl p-5"><h1 className="page-title">Mi día</h1><form className="my-4 flex items-end gap-2"><input className="mt-0 w-auto" name="fecha" type="date" defaultValue={day}/><button>Ver tareas</button></form>{searchParams.email && <p role="status">{searchParams.email === 'EMAIL_SENT' ? 'Email enviado.' : `Email no enviado: ${emailErrors[searchParams.email] ?? searchParams.email}`}</p>}{section('Hoy', today)}{section('Atrasadas', overdue)}{section('Próximos 7 días', upcoming)}{section('Por planificar', planning)}</main>;
}
