import { SubmitButton } from '@/app/submit-button';
import { deleteCompanyAction } from './delete-action';

export function DeleteCompany({ companyId }: { companyId: string }) {
  return <section id="eliminar" aria-label="Zona de peligro" className="card border border-red-200 p-4">
    <h2 className="font-semibold text-red-800">Zona de peligro</h2>
    <details className="mt-3"><summary className="cursor-pointer font-medium text-red-800">Eliminar empresa</summary>
      <p className="my-3 text-sm">Se borra definitivamente la empresa con sus contactos, tareas, guiones, investigación e historial. Las bajas y la auditoría se conservan. Si el Rastreo vuelve a encontrarla, podrá entrar como nueva, respetando las bajas.</p>
      <p className="my-3 text-sm">La empresa se conserva en trygestión. Si tiene una oportunidad vinculada, se encolará su cierre como perdida con el motivo «Eliminada en try! Comercial».</p>
      <form action={deleteCompanyAction} className="space-y-3">
        <input type="hidden" name="companyId" value={companyId}/>
        <label className="flex items-start gap-2"><input className="w-auto" type="checkbox" name="confirmed" required/>Entiendo que se borra definitivamente con sus contactos, tareas, guiones, investigación e historial</label>
        <SubmitButton className="bg-red-700 hover:bg-red-800" pendingText="Eliminando…">Eliminar definitivamente</SubmitButton>
      </form>
    </details>
  </section>;
}
