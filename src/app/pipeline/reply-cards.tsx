import { displayCompanyName } from '@/lib/prospecting/live-names';
import type { Company, EmailReply } from '@prisma/client';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { isSuppressed } from '@/lib/suppression';
import { pipelineStages, tomorrowMadrid } from '@/lib/email-replies';
import { taskTypeLabels } from '@/lib/mi-dia/filters';
import { SubmitButton } from '../submit-button';
import { handleReply } from './reply-actions';

export async function ReplyCards({ replies, canEdit }: { replies: (EmailReply & { company: Company | null })[]; canEdit: boolean }) {
  const suppressed = new Set((await Promise.all([...new Set(replies.flatMap(reply => reply.companyId ? [reply.companyId] : []))].map(async id => await isSuppressed(prisma, id) ? id : null))).filter(Boolean));
  return <div className="my-4 space-y-4">{replies.map(reply => <article className="card space-y-2 p-4 [overflow-wrap:anywhere]" key={reply.id} data-reply-id={reply.id}>
    <h3 className="font-semibold">{reply.company ? <Link href={`/empresas/${reply.company.id}`}>{displayCompanyName(reply.company)}</Link> : 'Sin empresa vinculada'}</h3>
    {suppressed.has(reply.companyId) && <p role="alert" className="rounded-lg bg-amber-50 p-2 text-amber-900">Empresa dada de baja. Revisa la supresión antes de contactar.</p>}
    <p><a href={`mailto:${reply.fromEmail}`}>{reply.fromEmail}</a> · <time dateTime={reply.receivedAt.toISOString()}>{new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' }).format(reply.receivedAt)} (Madrid)</time></p>
    <p className="font-semibold">{reply.subject}</p>
    <div className="flex flex-wrap gap-2">{reply.priority && <span className={`badge ${['alta', 'urgente'].includes(reply.priority) ? 'badge-a' : 'badge-b'}`}>Prioridad {reply.priority}</span>}{reply.category && <span className="badge badge-c">{reply.category}</span>}</div>
    {reply.summary && <p className="whitespace-pre-wrap">{reply.summary}</p>}
    {reply.excerpt && (reply.excerpt.length > 300 ? <details><summary>Ver extracto de la respuesta</summary><p className="whitespace-pre-wrap">{reply.excerpt}</p></details> : <p className="whitespace-pre-wrap">{reply.excerpt}</p>)}
    {reply.status === 'HANDLED' ? <p className="text-sm text-slate-600">Gestionada · {reply.handledAction} · {reply.handledAt && new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' }).format(reply.handledAt)}</p> : canEdit && <div className="space-y-3">
      {reply.companyId && <>
        <form action={handleReply} className="flex flex-wrap items-end gap-2"><input type="hidden" name="replyId" value={reply.id}/><input type="hidden" name="action" value="seguimiento"/>
          <label>Tipo de seguimiento<select name="type" defaultValue="FOLLOW_UP">{Object.entries(taskTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Fecha del seguimiento<input type="date" name="date" required defaultValue={tomorrowMadrid()}/></label>
          <label>Nota opcional<input name="note" maxLength={2000}/></label><SubmitButton pendingText="Creando…">Crear seguimiento</SubmitButton>
        </form>
        <form action={handleReply} className="flex flex-wrap items-end gap-2"><input type="hidden" name="replyId" value={reply.id}/><input type="hidden" name="action" value="etapa"/>
          <label>Etapa del pipeline<select name="stage" defaultValue={reply.company?.pipelineStage}>{pipelineStages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><SubmitButton className="btn-secondary" pendingText="Moviendo…">Mover a etapa</SubmitButton>
        </form>
      </>}
      <form action={handleReply}><input type="hidden" name="replyId" value={reply.id}/><input type="hidden" name="action" value="vista"/><SubmitButton className="btn-secondary" pendingText="Guardando…">Marcar como vista</SubmitButton></form>
    </div>}
  </article>)}</div>;
}
