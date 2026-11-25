import type { ContactStatus } from '@/lib/contact-status';
const styles = { green: 'bg-emerald-100 text-emerald-900', amber: 'bg-amber-100 text-amber-900', red: 'bg-red-100 text-red-900', gray: 'bg-slate-200 text-slate-800' };
const dots = { green: 'bg-emerald-600', amber: 'bg-amber-600', red: 'bg-red-600', gray: 'bg-slate-600' };
export function ContactBadge({ status, detail = false }: { status: ContactStatus; detail?: boolean }) {
  return <div title={status.detail} data-contact-color={status.color}><span className={`inline-flex items-center gap-2 rounded-full px-2 py-1 text-xs font-semibold ${styles[status.color]}`}><span aria-hidden="true" className={`h-2 w-2 rounded-full ${dots[status.color]}`}/>{status.label}</span>{detail && <p className="mt-1 text-sm">{status.detail}</p>}</div>;
}
export function ContactWarning({ status }: { status: ContactStatus }) {
  if (!['red', 'gray'].includes(status.color)) return null;
  return <div role="alert" className="my-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm"><p>{status.detail}</p>{status.color === 'red' ? <label className="block"><input className="mr-2 w-auto" type="checkbox" name="contactConfirmed" required/>Sí, quiero contactarla igualmente</label> : <p>No se puede contactar con esta empresa.</p>}</div>;
}
