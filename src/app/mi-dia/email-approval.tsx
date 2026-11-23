import { approveEmail } from './actions';
import { SubmitButton } from '../submit-button';
export function EmailApproval({ taskId, fecha, to, email, firma }: { taskId: string; fecha: string; to: string; email: { asunto: string; cuerpo: string }; firma: { nombre: string; cargo: string } }) {
  return <details className="mt-3 border p-3"><summary>Revisar y enviar email</summary><form action={approveEmail} className="space-y-3">
    <input type="hidden" name="taskId" value={taskId}/><input type="hidden" name="fecha" value={fecha}/>
    <label className="block">Destinatario corporativo<input type="email" name="to" required defaultValue={to} placeholder="info@empresa.es"/></label>
    {!to && <p className="text-sm text-slate-600">Esta empresa aún no tiene email. Escribe su email corporativo: al enviar se guarda en su ficha y en trygestión.</p>}
    <label className="block">Asunto<input className="w-full" name="subject" required defaultValue={email.asunto}/></label>
    <label className="block">Cuerpo<textarea className="w-full" rows={12} name="body" required defaultValue={email.cuerpo}/></label>
    <fieldset className="grid gap-2 sm:grid-cols-2"><legend>Tu firma (con el logo de try! company; se guarda para tus próximos envíos)</legend>
      <label className="block">Nombre<input className="w-full" name="firmaNombre" required maxLength={120} defaultValue={firma.nombre}/></label>
      <label className="block">Cargo<input className="w-full" name="firmaCargo" maxLength={120} placeholder="Ej.: Gerente" defaultValue={firma.cargo}/></label>
    </fieldset>
    <p>Revisa destinatario, base legal y texto. Sustituye [TELÉFONO] y [WEB]. Al enviar se añaden tu firma, una invitación a conocernos y el pie de BAJA.</p>
    <label className="block"><input type="checkbox" name="approved" required/> He revisado el contenido y apruebo este envío.</label><SubmitButton pendingText="Enviando…" notice="Enviando el email a través de trygestión…">Aprobar y enviar email</SubmitButton>
  </form></details>;
}
