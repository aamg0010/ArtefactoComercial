import Link from 'next/link';
import type { buildGuide } from '@/lib/guia/engine';
import { addDays } from '@/lib/guia/engine';
import { guideAction } from './guide-actions';
import { recordTaskResult } from './actions';
import { SubmitButton } from '../submit-button';

export function DayGuide({ guide, canEdit }: { guide: ReturnType<typeof buildGuide>; canEdit: boolean }) {
  return <section aria-label="Guía del día" className="card my-4 min-w-0 space-y-3 p-3 sm:p-5">
    <h2 className="text-xl font-semibold">Guía del día</h2>
    <div className="flex flex-wrap gap-2">{guide.groups.map(group => <a key={group.id} href={`#guia-${group.id}`} className="badge badge-b" data-testid={`guide-count-${group.id}`}>{group.title}: {group.count}</a>)}</div>
    {!guide.groups.some(g => g.count) && <p>Todo al día ✅</p>}
    {guide.groups.filter(g => g.count > 0).map(group => <details key={group.id} id={`guia-${group.id}`} open={group.id !== 'tomorrow' && group.id !== 'prepare'} className="min-w-0 border-t pt-3" data-testid={`guide-group-${group.id}`}>
      <summary className="cursor-pointer font-semibold">{group.title} ({group.count})</summary>
      {group.id === 'prepare' ? <p className="mt-2 text-sm">Sin investigar: {guide.preparation.research} · Investigadas sin guion: {guide.preparation.script} · Borradores sin aprobar: {guide.preparation.approval}</p> :
        <ol className="mt-3 space-y-4">{group.items.map(item => <li key={item.id} data-notice-id={item.id} className="min-w-0 rounded-lg border border-slate-200 p-3">
          <p className="font-semibold">{item.companyId ? <Link className="hover:underline" href={`/empresas/${item.companyId}`}>{item.companyName}</Link> : item.companyName}</p>
          <p>{item.title}</p><p className="text-sm text-slate-600">{item.reason}</p>
          {group.id === 'replies' && <Link className="btn-secondary mt-2 inline-block" href="/pipeline">Ver respuesta</Link>}
          {canEdit && group.id !== 'tomorrow' && <div className="mt-3 flex min-w-0 flex-wrap gap-2">
            {item.taskId && <>
              <form action={recordTaskResult} className="flex min-w-0 flex-wrap gap-2">
                <input type="hidden" name="taskId" value={item.taskId}/><label>Notas<textarea name="notes" maxLength={2000}/></label><label>Con quién se habló<input name="interlocutor" maxLength={200}/></label>
                <label className="min-w-0">Resultado<select name="result" className="max-w-full"><option>No contesta</option><option>Buzón</option><option>Contactado</option><option>Interesado</option><option>No interesado</option><option>Baja</option></select></label>
                <SubmitButton pendingText="Guardando…">Hecho</SubmitButton>
              </form>
              <form action={guideAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="action" value="postpone"/><input type="hidden" name="taskId" value={item.taskId}/><input type="hidden" name="expectedDay" value={item.dueDay}/>
                {[1, 3, 7].map(days => <SubmitButton key={days} className="btn-secondary" name="days" value={String(days)} pendingText="Posponiendo…">Posponer {days} {days === 1 ? 'día' : 'días'}</SubmitButton>)}
              </form>
            </>}
            {['next', 'stalled'].includes(group.id) && <form action={guideAction} className="flex min-w-0 flex-wrap items-end gap-2">
              <input type="hidden" name="action" value="next"/><input type="hidden" name="companyId" value={item.companyId}/>
              <label>Tipo de siguiente paso<select name="type"><option value="CALL">Llamada</option><option value="EMAIL">Email</option><option value="FOLLOW_UP">Seguimiento</option></select></label>
              <label className="min-w-0">Fecha del siguiente paso<input className="max-w-full" type="date" name="date" required defaultValue={addDays(guide.day, 1)}/></label>
              <SubmitButton pendingText="Creando…">Crear siguiente paso</SubmitButton>
            </form>}
            {group.id === 'closed' && <form action={guideAction}>
              <input type="hidden" name="action" value="pause"/><input type="hidden" name="companyId" value={item.companyId}/><input type="hidden" name="cadenceId" value={item.cadenceId}/>
              <SubmitButton pendingText="Pausando…">Pausar 90 días</SubmitButton>
            </form>}
          </div>}
        </li>)}</ol>}
    </details>)}
  </section>;
}
