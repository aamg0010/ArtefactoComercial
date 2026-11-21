import Image from 'next/image';
import { prisma } from '@/lib/prisma';
import { GooglePlacesAdapter } from '@/lib/sources/google-places';
import { prepareAcceptance, signProposal, type AcceptanceProposal } from '@/lib/prospecting/acceptance';
import type { CandidateCompany } from '@/lib/sources/types';
import { companyAction } from './actions';

/** Live Google data is never used to prefill the acceptance fields. */
export async function PlacesView({ companyId, country }: { companyId: string; country: 'ES' | 'CO' }) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, include: { sourceIdentities: true } });
  const pending = company.acceptanceStatus === 'PENDING';
  let live: CandidateCompany | null = null;
  let proposal: AcceptanceProposal = { companyId, expires: Date.now() + 15 * 60_000, fields: {} };
  let note = '';
  if (pending) {
    const prepared = await prepareAcceptance(prisma, companyId); live = prepared.live; proposal = prepared.proposal; note = prepared.note;
  } else if (process.env.GOOGLE_PLACES_API_KEY?.trim()) {
    const ref = company.sourceIdentities.find(item => item.source === 'google-places');
    if (ref) try { live = await new GooglePlacesAdapter(process.env.GOOGLE_PLACES_API_KEY).details(ref.sourceRef, country); } catch { note = 'No se pudieron consultar los datos de Google en vivo.'; }
  }
  const proof = pending && process.env.AUTH_SECRET ? signProposal(proposal) : '';
  return <>
    {live && <section aria-label="Google Places en vivo" className="rounded bg-white p-4">
      <Image src="https://developers.google.com/static/maps/documentation/images/google_on_white.png" alt="Google" width={120} height={40} unoptimized/>
      <h2 className="font-semibold">{live.name}</h2><p>Datos de Google consultados en vivo, no guardados. No copie estos datos al formulario: use la web propia o información independiente.</p>
      <p>{live.address} · {live.category}</p>
      {live.website && <a className="underline" href={live.website} target="_blank" rel="noreferrer">Web corporativa publicada en Google</a>}
      {live.corporatePhone && <p>Teléfono publicado en Google: {live.corporatePhone}</p>}
      {live.sourceUrl && <a className="underline" href={live.sourceUrl} target="_blank" rel="noreferrer">Ver ficha en Google Maps</a>}
      {live.attributions?.map(item => <p key={item.uri}><a href={item.uri} rel="noreferrer" target="_blank">{item.displayName}</a></p>)}
    </section>}
    {pending && <section aria-label="Aceptar empresa" className="space-y-3 rounded bg-white p-4">
      <h2 className="text-lg font-semibold">Aceptar empresa</h2><p>Pendiente de aceptar: no entra en investigación ni en Mi día.</p>
      <p>{note}</p>
      <h3 className="font-semibold">Propuesta de la web propia</h3>
      <ul>{Object.entries(proposal.fields).map(([key, claim]) => claim && <li key={key}>{key}: {claim.value} · <a className="underline" href={claim.url} rel="noreferrer" target="_blank">{claim.url}</a> · {claim.date.slice(0, 10)}</li>)}</ul>
      <p>Revise y edite. Los campos cambiados o sin evidencia web se guardarán como «confirmado manualmente». No se guardará nada hasta confirmar.</p>
      <form action={companyAction} className="grid gap-3 md:grid-cols-2">
        <input type="hidden" name="companyId" value={companyId}/><input type="hidden" name="proof" value={proof}/>
        <label>Nombre confirmado<input name="name" required defaultValue={proposal.fields.name?.value ?? ''}/></label>
        <label>Municipio confirmado<input name="city" required defaultValue={proposal.fields.city?.value ?? ''}/></label>
        <label>Web confirmada<input name="website" type="url" defaultValue={proposal.fields.website?.value ?? ''}/></label>
        <label>Teléfono corporativo confirmado<input name="phone" defaultValue={proposal.fields.phone?.value ?? ''}/></label>
        <label>Email corporativo confirmado<input name="email" type="email" defaultValue={proposal.fields.email?.value ?? ''}/></label>
        <label><input className="mr-2 w-auto" type="checkbox" name="confirmed" required/>Confirmo datos corporativos de la web propia o información independiente, no copiados de Google.</label>
        <button name="action" value="accept">Aceptar empresa</button>
      </form>
      <form action={companyAction}><input type="hidden" name="companyId" value={companyId}/><button name="action" value="discard">Descartar</button></form>
    </section>}
  </>;
}
