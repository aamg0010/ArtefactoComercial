import Link from 'next/link';
import { withoutPlaceIds } from '@/lib/prospecting/live-names';
import type { Company, CompanySource, Contact } from '@prisma/client';
import { isVerifiedDirectContact } from '@/lib/company-contact';
import { consentLabels, legalBasisInfo, sourceLabels, sourceLink } from '@/lib/contacts/labels';
import { SubmitButton } from '../../submit-button';
import { addContactAction, consentAction, deleteContactAction, updateCompanyAction } from './contact-actions';

const link = 'font-medium text-try-700 hover:underline [overflow-wrap:anywhere]';
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-0.5 [overflow-wrap:anywhere]">{children}</dd></div>;
}

/** Datos de contacto de la empresa (lo que interesa para llamar o escribir) y sus personas de contacto. */
export function CompanyContact({ company, contacts, sources, editable }: { company: Company; contacts: Contact[]; sources: CompanySource[]; editable: boolean }) {
  const web = company.website ?? (company.normalizedDomain ? `https://${company.normalizedDomain}` : null);
  return <>
    <dl className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Teléfono">{company.phone ? <a className={link} href={telHref(company.phone)}>{company.phone}</a> : <span className="text-slate-500">Sin teléfono</span>}</Field>
      <Field label="Email">{company.email ? <a className={link} href={`mailto:${company.email}`}>{company.email}</a> : <span className="text-slate-500">Sin email</span>}</Field>
      <Field label="Web">{web ? <a className={link} href={web} target="_blank" rel="noreferrer">{web.replace(/\/$/, '')}</a> : <span className="text-slate-500">Sin web registrada</span>}</Field>
      <Field label="Dirección">{company.address ?? <span className="text-slate-500">Sin dirección</span>}</Field>
      <Field label="Ubicación">{[company.city ?? 'Municipio por verificar', company.comarca, company.region, company.country].filter(Boolean).join(' · ')}</Field>
      <Field label={company.country === 'CO' ? 'NIT' : 'NIF'}>{company.nifNit ?? <span className="text-slate-500">Sin dato</span>}</Field>
      <Field label="Sector">{company.sector ?? <span className="text-slate-500">Sector pendiente</span>}</Field>
      <Field label="Prioridad actual">{company.priority ?? 'Sin asignar'}</Field>
      <Field label="Próxima acción">{company.nextAction ?? 'Por definir'}</Field>
      <Field label="Origen">
        {company.sourceDetail ? withoutPlaceIds(company.sourceDetail) : null}
        {sources.map(source => {
          const href = sourceLink(source.source, source.sourceRef, source.sourceUrl);
          return <span key={source.id} className="block text-sm text-slate-600">
            {sourceLabels[source.source] ?? source.source} · {source.observedAt.toISOString().slice(0, 10)}
            {href && <> · <a className={link} href={href} target="_blank" rel="noreferrer">{source.source === 'google-places' ? 'Ver en Google Maps' : 'Ver fuente'}</a></>}
            {source.attribution && (source.source === 'openstreetmap' ? <> · <a className={link} href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">{source.attribution}</a></> : <> · {source.attribution}</>)}
          </span>;
        })}
      </Field>
    </dl>

    {editable && company.acceptanceStatus === 'ACCEPTED' && (company.website || sources.some(source => source.source === 'google-places')) && (!company.website || !company.phone || !company.email) && <p className="mt-4"><Link className={link} href={`/empresas/${company.id}/completar`} prefetch={false}>Completar datos desde su web</Link></p>}

    {editable && <details className="mt-4 rounded-xl border border-slate-200 p-3">
      <summary className="cursor-pointer font-display font-semibold text-try-900">✏️ Editar datos de la empresa</summary>
      <form action={updateCompanyAction} className="mt-3 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="companyId" value={company.id}/>
        <label>Teléfono<input name="phone" defaultValue={company.phone ?? ''} inputMode="tel"/></label>
        <label>Email corporativo<input name="email" type="email" defaultValue={company.email ?? ''}/></label>
        <label>Web<input name="website" defaultValue={company.website ?? ''} placeholder="https://"/></label>
        <label>Dirección<input name="address" defaultValue={company.address ?? ''}/></label>
        <label>Municipio<input name="city" defaultValue={company.city ?? ''}/></label>
        <label>{company.country === 'CO' ? 'Departamento' : 'Provincia / región'}<input name="region" defaultValue={company.region ?? ''}/></label>
        <label>Sector<input name="sector" defaultValue={company.sector ?? ''}/></label>
        <label>{company.country === 'CO' ? 'NIT' : 'NIF'}<input name="nifNit" defaultValue={company.nifNit ?? ''}/></label>
        <div className="sm:col-span-2"><SubmitButton pendingText="Guardando…">Guardar datos</SubmitButton></div>
      </form>
    </details>}

    <section id="contactos" aria-label="Personas de contacto" className="mt-5">
      <h3 className="font-display text-base font-semibold">Personas de contacto ({contacts.length})</h3>
      {!contacts.length && <p className="text-sm text-slate-500">Todavía no hay personas de contacto.</p>}
      <ul className="mt-2 grid gap-3 md:grid-cols-2">{contacts.map(contact => {
        const basis = legalBasisInfo[contact.legalBasis];
        return <li key={contact.id} className="min-w-0 rounded-xl border border-slate-200 p-3">
          <p className="font-semibold [overflow-wrap:anywhere]">{contact.fullName}{contact.role && <span className="font-normal text-slate-600"> · {contact.role}</span>}</p>
          <p className="text-sm">
            {contact.email?.trim() && <a className={`${link} mr-3`} href={`mailto:${contact.email}`}>{contact.email}</a>}
            {contact.phone?.trim() && <a className={link} href={telHref(contact.phone)}>{contact.phone}</a>}
            {!contact.email?.trim() && !contact.phone?.trim() && <span className="text-slate-500">Sin canal de contacto directo</span>}
          </p>
          <p className="mt-1 flex flex-wrap gap-1 text-xs">
            <span className="badge">{isVerifiedDirectContact(contact) ? 'Verificado' : 'Pendiente de verificar'}</span>
            <span className="badge" title={basis.help}>Base legal: {basis.label}</span>
            {contact.requiresConsent && <span className="badge badge-warning">Consentimiento: {consentLabels[contact.consentStatus]}</span>}
          </p>
          {editable && <div className="mt-2 flex flex-wrap items-start gap-2 text-sm">
            {contact.requiresConsent && contact.consentStatus !== 'GRANTED' && <form action={consentAction}><input type="hidden" name="companyId" value={company.id}/><input type="hidden" name="contactId" value={contact.id}/><input type="hidden" name="status" value="GRANTED"/><SubmitButton className="btn-secondary" pendingText="Guardando…">Marcar consentimiento dado</SubmitButton></form>}
            {contact.requiresConsent && contact.consentStatus === 'GRANTED' && <form action={consentAction}><input type="hidden" name="companyId" value={company.id}/><input type="hidden" name="contactId" value={contact.id}/><input type="hidden" name="status" value="WITHDRAWN"/><SubmitButton className="btn-secondary" pendingText="Guardando…">Retiró el consentimiento</SubmitButton></form>}
            <details><summary className="cursor-pointer text-red-700">Borrar</summary>
              <form action={deleteContactAction} className="mt-2"><input type="hidden" name="companyId" value={company.id}/><input type="hidden" name="contactId" value={contact.id}/>
                <p className="text-xs text-slate-600">Se borra de try! Comercial y de trygestión.</p>
                <SubmitButton className="bg-red-600 hover:bg-red-700" pendingText="Borrando…">Sí, borrar {contact.fullName}</SubmitButton></form>
            </details>
          </div>}
        </li>;
      })}</ul>

      {/* key: tras guardar, el formulario se vuelve a montar vacío (y cerrado si ya hay contactos). */}
      {editable && <details key={contacts.map(contact => contact.id).join()} className="mt-4 rounded-xl border border-slate-200 p-3" open={!contacts.length}>
        <summary className="cursor-pointer font-display font-semibold text-try-900">➕ Añadir persona de contacto</summary>
        <form action={addContactAction} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="companyId" value={company.id}/>
          <label>Nombre<input name="fullName" required minLength={2} placeholder="Nombre y apellidos o «Administración»"/></label>
          <label>Cargo<input name="role" placeholder="Gerente, compras, administración…"/></label>
          <label>Email<input name="email" type="email"/></label>
          <label>Teléfono<input name="phone" inputMode="tel"/></label>
          <label>Base legal<select name="legalBasis" defaultValue="LEGITIMATE_INTEREST">{Object.entries(legalBasisInfo).map(([value, info]) => <option key={value} value={value}>{info.label}</option>)}</select></label>
          <label className="flex items-start gap-2 self-end text-sm"><input className="mt-1 w-auto" name="requiresConsent" type="checkbox"/>Requiere consentimiento antes de enviarle emails</label>
          <div className="sm:col-span-2"><SubmitButton pendingText="Guardando…">Añadir contacto</SubmitButton></div>
        </form>
        <details className="mt-3 text-sm text-slate-700"><summary className="cursor-pointer font-medium">¿Qué significa cada opción?</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {Object.values(legalBasisInfo).map(info => <li key={info.label}><b>{info.label}</b>: {info.help}</li>)}
            <li><b>Requiere consentimiento</b>: márcalo si a esta persona solo se le puede escribir con su permiso (por ejemplo, un email personal o un autónomo). Mientras el consentimiento esté pendiente, la app no deja enviarle emails; cuando te lo dé, pulsa «Marcar consentimiento dado».</li>
          </ul>
        </details>
      </details>}
    </section>
  </>;
}
