import { prisma } from '@/lib/prisma';
import { recordTaskResult } from './actions';
import { madridDate, taskDate } from '@/lib/dates';
import { ScriptView } from './script-view';
import Link from 'next/link';
import { EmailApproval } from './email-approval';
import { trygestionConfiguration } from '@/lib/trygestion/client';

const results = ['Contactado', 'No contesta', 'Buzón', 'Interesado', 'Reunión agendada', 'No interesado', 'Baja'];
type Content = { llamada?: { apertura?: string; motivo?: string; pregunta_clave?: string; propuesta_valor?: string; objeciones?: Record<string, string>; cierre?: string; mensaje_voz?: string }; emails?: { dia: number; asunto: string; cuerpo: string }[] };

export default async function MyDay({ searchParams }: { searchParams: { fecha?: string; email?: string } }) {
  const day = searchParams.fecha ?? madridDate();
  const all = await prisma.task.findMany({ where: { status: 'PENDING', company: { acceptanceStatus: 'ACCEPTED' }, OR: [{ dueAt: { lte: new Date(`${day}T23:59:59.999Z`) } }, { dueAt: null }] }, include: { company: { include: { contacts: true } }, script: true, cadenceStep: true }, orderBy: [{ company: { priority: 'asc' } }, { dueAt: 'asc' }] });
  const today = all.filter((task) => taskDate(task.dueAt) === day);
  const overdue = all.filter((task) => task.dueAt && taskDate(task.dueAt)! < day);
  const planning = all.filter((task) => !task.dueAt);
  const section = (title: string, tasks: typeof all) => <section aria-label={title} className="mb-8"><h2 className="text-lg font-semibold">{title} ({tasks.length})</h2><div className="mt-3 space-y-4">{tasks.map((task) => <article key={task.id} className="rounded-lg bg-white p-4 shadow"><h3 className="font-semibold"><Link className="underline" href={`/empresas/${task.companyId}`}>{task.company.priority ?? 'C'} · {task.company.name}</Link></h3><p>{task.title}</p>{task.script && <details className="mt-2"><summary>Guion y emails</summary><ScriptView content={task.script.content as Content}/></details>}{process.env.EMAIL_TRANSPORT === 'trygestion' && trygestionConfiguration().enabled && task.type === 'EMAIL' && task.script && (task.script.content as Content).emails?.filter(email => email.dia === task.cadenceStep?.dayOffset).map(email => <EmailApproval key={email.dia} taskId={task.id} fecha={day} to={task.company.email ?? task.company.contacts.find(contact => contact.email)?.email ?? ''} email={email}/>)}<form action={recordTaskResult} className="mt-3 flex flex-wrap gap-2"><input type="hidden" name="taskId" value={task.id}/><fieldset className="w-full"><legend>Reunión: fecha y hora (zona del calendario)</legend><label>Fecha<input type="date" name="meetingDate"/></label><label>Hora<input type="time" name="meetingTime"/></label><label>Ubicación<input name="meetingLocation"/></label></fieldset>{results.map((result) => <button key={result} name="result" value={result}>{result}</button>)}</form></article>)}</div></section>;
  return <main className="mx-auto max-w-4xl p-5"><h1 className="text-2xl font-bold">Mi día</h1><form className="my-4"><input name="fecha" type="date" defaultValue={day}/><button className="ml-2">Ver tareas</button></form>{searchParams.email && <p role="status">{searchParams.email === 'EMAIL_SENT' ? 'Email enviado.' : `Email no enviado: ${searchParams.email}`}</p>}{section('Hoy', today)}{section('Atrasadas', overdue)}{section('Por planificar', planning)}</main>;
}
