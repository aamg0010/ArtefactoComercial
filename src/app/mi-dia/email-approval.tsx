import { approveEmail } from './actions';
export function EmailApproval({ taskId, fecha, to, email }: { taskId: string; fecha: string; to: string; email: { asunto: string; cuerpo: string } }) {
  return <details className="mt-3 border p-3"><summary>Revisar y enviar email</summary><form action={approveEmail} className="space-y-3">
    <input type="hidden" name="taskId" value={taskId}/><input type="hidden" name="fecha" value={fecha}/>
    <label className="block">Destinatario corporativo<input type="email" name="to" required defaultValue={to}/></label>
    <label className="block">Asunto<input className="w-full" name="subject" required defaultValue={email.asunto}/></label>
    <label className="block">Cuerpo<textarea className="w-full" rows={12} name="body" required defaultValue={email.cuerpo}/></label>
    <p>Revisa destinatario, base legal y texto. Sustituye [TELÉFONO] y [WEB]. Se añadirá el enlace de BAJA.</p>
    <label className="block"><input type="checkbox" name="approved" required/> He revisado el contenido y apruebo este envío.</label><button>Aprobar y enviar email</button>
  </form></details>;
}
