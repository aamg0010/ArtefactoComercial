import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { prepareWebsiteProposal, safeCompanyId, signProposal } from '@/lib/prospecting/acceptance';
import { completionFields } from '@/lib/prospecting/complete-web';
import { completeWebAction } from '../complete-web-actions';
import { SubmitButton } from '@/app/submit-button';

export const dynamic = 'force-dynamic';
const labels = { website: 'Web confirmada', phone: 'Teléfono corporativo confirmado', email: 'Email corporativo confirmado' };

export default async function CompleteWebsite({ params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id || session.user.role === 'DIRECTOR') throw new Error('No autorizado');
  const id = safeCompanyId.parse(params.id);
  const { proposal, note, live } = await prepareWebsiteProposal(prisma, id, 'complete-web');
  return <main className="mx-auto max-w-3xl space-y-4 p-5">
    <h1 className="page-title">Completar datos desde su web</h1>
    <p>{note}</p>
    {live && <section aria-label="Google consultado en vivo" className="card p-4">
      <p>Google: datos consultados en vivo, no guardados. No copie estos datos al formulario.</p>
      <p>Teléfono publicado en Google: {live.corporatePhone}</p><p>{live.address}</p>
      {live.sourceUrl && <a href={live.sourceUrl} target="_blank" rel="noreferrer">Ver en Google Maps</a>}
      {live.attributions?.map(item => <p key={item.uri}><a href={item.uri} target="_blank" rel="noreferrer">{item.displayName}</a></p>)}
    </section>}
    <section aria-label="Propuesta de la web propia" className="card space-y-3 p-4">
      <h2 className="font-semibold">Propuesta de la web propia</h2>
      <p>Revise los datos. Los campos vacíos o editados se confirmarán manualmente. Los datos ya registrados se conservan salvo que marque expresamente su sustitución.</p>
      <form action={completeWebAction} className="grid gap-4">
        <input type="hidden" name="companyId" value={id}/><input type="hidden" name="proof" value={signProposal(proposal)}/>
        {completionFields.map(field => {
          const claim = proposal.fields[field];
          const current = proposal.baseline?.[field];
          return <div key={field}>
            <label>{labels[field]}<input name={field} type={field === 'website' ? 'url' : field === 'email' ? 'email' : 'tel'} defaultValue={claim?.value ?? ''}/></label>
            {claim && <p className="text-sm">Web propia: <a className="underline" href={claim.url} target="_blank" rel="noreferrer">{claim.url}</a> · {claim.date}</p>}
            {current && <><p>Dato confirmado actual: {current}</p><label><input className="mr-2 w-auto" type="checkbox" name={`replace-${field}`}/>Sustituir el dato confirmado de {labels[field].toLowerCase()}</label></>}
          </div>;
        })}
        <label><input className="mr-2 w-auto" type="checkbox" name="confirmed" required/>Confirmo datos corporativos de la web propia o información independiente, no copiados de Google.</label>
        <SubmitButton pendingText="Guardando…">Guardar datos</SubmitButton>
      </form>
    </section>
    <Link href={`/empresas/${id}`}>Volver a la empresa</Link>
  </main>;
}
