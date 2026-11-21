import Image from 'next/image';
import { prisma } from '@/lib/prisma';
import { GooglePlacesAdapter } from '@/lib/sources/google-places';

/** Live, no-store view: do not copy Google response fields into the CRM. */
export async function PlacesView({ companyId, country }: { companyId: string; country: 'ES' | 'CO' }) {
  if (!process.env.GOOGLE_PLACES_API_KEY?.trim()) return null;
  const identity = await prisma.companySource.findFirst({ where: { companyId, source: 'google-places' } });
  if (!identity) return null;
  try {
    const company = await new GooglePlacesAdapter(process.env.GOOGLE_PLACES_API_KEY).details(identity.sourceRef, country);
    if (!company) return null;
    return <section aria-label="Google Places en vivo" className="rounded bg-white p-4">
      <Image src="https://developers.google.com/static/maps/documentation/images/google_on_white.png" alt="Google" width={120} height={40} unoptimized/>
      <h2 className="font-semibold">{company.name}</h2><p>Datos consultados en vivo en Google Places; no almacenados. Verificar antes de contactar.</p>
      <p>{company.address} · {company.category}</p>
      {company.website && <p><a className="underline" href={company.website} target="_blank" rel="noreferrer">Web corporativa</a></p>}
      {company.corporatePhone && <p>Teléfono corporativo publicado: {company.corporatePhone}</p>}
      {company.sourceUrl && <a className="underline" href={company.sourceUrl} target="_blank" rel="noreferrer">Ver ficha en Google Maps</a>}
      {company.attributions?.map(item => <p key={item.uri}><a href={item.uri} rel="noreferrer" target="_blank">{item.displayName}</a></p>)}
    </section>;
  } catch { return <p role="status">No se pudieron consultar los datos de Google Places en vivo.</p>; }
}
