import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { madridDate, madridDayBounds } from '@/lib/dates';
import { prospectingSimulated } from '@/lib/sources';
import { sourceNames } from '@/lib/sources/types';
import { prospectingAction } from './actions';
import type { SearchProfile } from '@prisma/client';
import { osmAttribution } from '@/lib/sources/openstreetmap';

export const dynamic = 'force-dynamic';
export default async function Prospecting({ searchParams }: { searchParams: { error?: string; done?: string } }) {
  const session = await auth(); const manage = session?.user?.role === 'ADMIN';
  const profiles = await prisma.searchProfile.findMany({ orderBy: { createdAt: 'asc' } });
  const products = await prisma.product.findMany({ where: { active: true }, orderBy: { line: 'asc' } });
  const runs = await prisma.sourceRun.findMany({ include: { profile: true }, orderBy: { startedAt: 'desc' }, take: 50 });
  const day = madridDate(); const { start, end } = madridDayBounds(day);
  const detection = { detectedAt: { gte: start, lt: end } };
  const [ready, pending, readyCount, pendingCount] = await Promise.all([
    prisma.company.findMany({ where: { ...detection, acceptanceStatus: 'ACCEPTED' }, include: { sourceIdentities: true }, orderBy: { detectedAt: 'desc' }, take: 200 }),
    prisma.company.findMany({ where: { ...detection, acceptanceStatus: 'PENDING' }, include: { sourceIdentities: true }, orderBy: { detectedAt: 'desc' }, take: 200 }),
    prisma.company.count({ where: { ...detection, acceptanceStatus: 'ACCEPTED' } }),
    prisma.company.count({ where: { ...detection, acceptanceStatus: 'PENDING' } }),
  ]);
  const companies = [...ready, ...pending];
  const editor = (profile?: SearchProfile) => <form action={prospectingAction} className="grid gap-3 md:grid-cols-2">
    <input type="hidden" name="profileId" value={profile?.id ?? ''}/>
    <label>Nombre del perfil<input name="name" required defaultValue={profile?.name}/></label>
    <label>País<select name="country" defaultValue={profile?.country ?? 'ES'}><option value="ES">España</option><option value="CO">Colombia</option></select></label>
    {([['provinces', 'Provincias'], ['comarcas', 'Comarcas'], ['municipalities', 'Municipios'], ['keywords', 'Sector / palabras clave'], ['cnaeCodes', 'Códigos CNAE (opcional)']] as const).map(([key, label]) => <label key={key}>{label}<input name={key} required={['provinces', 'municipalities', 'keywords'].includes(key)} defaultValue={profile?.[key].join('; ')}/></label>)}
    <label>Línea de producto<select name="productLine" defaultValue={profile?.productLine ?? products[0]?.line}>{products.map(product => <option value={product.line} key={product.id}>{product.line}</option>)}</select></label>
    <fieldset><legend>Fuentes</legend>{sourceNames.map(source => <label className="mr-3 inline-block" key={source}><input className="mr-1 w-auto" type="checkbox" name="sources" value={source} defaultChecked={(profile ? profile.sources.length ? profile.sources : [profile.source] : ['openstreetmap', 'google-places']).includes(source)}/>{source}{['apollo', 'einforma', 'rues', 'linkedin-export'].includes(source) ? ' (pendiente)' : ''}</label>)}</fieldset>
    <label>Máximo de resultados<input name="maxResults" type="number" min="1" max="200" defaultValue={profile?.maxResults ?? 6} required/></label>
    <label>CSV corporativo (sólo fuente csv)<textarea name="csv" placeholder="empresa,municipio,provincia,pais,web,telefono"/></label>
    <label><input name="active" type="checkbox" className="mr-2 w-auto" defaultChecked={profile?.active}/>Activo</label>
    <p className="text-sm">Separa listas con punto y coma. Datos sólo de empresas: sin nombres ni canales personales. Con clave, la opción mock usa Google real.</p>
    <button name="action" value="save">{profile ? 'Guardar cambios' : 'Crear perfil'}</button>
  </form>;
  return <main className="mx-auto max-w-6xl space-y-6 p-5">
    <h1 className="text-2xl font-bold">Rastreo</h1>
    {prospectingSimulated() && <p role="status" className="bg-amber-100 p-3">Rastreo en modo simulado</p>}
    <p>Sin clave, sólo Google se simula. OpenStreetMap consulta datos reales públicos. <a className="underline" href="https://www.openstreetmap.org/copyright" rel="noreferrer" target="_blank">{osmAttribution}</a></p>
    {searchParams.error && <p role="alert">No se pudo completar la operación. Revisa los campos, permisos y el historial.</p>}
    {searchParams.done && <p role="status">Operación completada. Consulta el historial para ver los resultados.</p>}
    <section aria-label="Nuevo perfil" className="rounded bg-white p-4"><h2 className="text-lg font-semibold">Nuevo perfil</h2>{manage ? editor() : <p>Sólo administración puede crear o editar perfiles.</p>}</section>
    <section aria-label="Perfiles"><h2 className="text-lg font-semibold">Perfiles de búsqueda</h2>{profiles.map(profile => <article aria-label={profile.name} key={profile.id} className="my-3 rounded bg-white p-4">
      <h3 className="font-semibold">{profile.name}</h3><p>{profile.active ? 'Activo' : 'Inactivo'} · {(profile.sources.length ? profile.sources : [profile.source]).join(' + ')} · {profile.country} · Máximo {profile.maxResults}</p>
      <p>{profile.municipalities.join(', ')} · {profile.keywords.join(', ')}</p>
      <form action={prospectingAction} className="my-2 flex gap-2"><input type="hidden" name="profileId" value={profile.id}/><button name="action" value="toggle" disabled={!manage}>{profile.active ? 'Desactivar' : 'Activar'}</button><button name="action" value="run" disabled={!profile.active || session?.user?.role === 'DIRECTOR'}>Ejecutar ahora</button></form>
      {manage && <details><summary>Editar perfil</summary>{editor(profile)}</details>}
    </article>)}</section>
    <section aria-label="Detectadas hoy" className="rounded bg-white p-4"><h2 className="text-lg font-semibold">Detectadas hoy ({readyCount + pendingCount}) · {day}</h2>
      {(['ACCEPTED', 'PENDING'] as const).map(status => {
        const rows = companies.filter(company => company.acceptanceStatus === status); const label = status === 'ACCEPTED' ? 'Listas para trabajar' : 'Pendientes de aceptar';
        const count = status === 'ACCEPTED' ? readyCount : pendingCount;
        return <section key={status} aria-label={label}><h3 className="font-semibold">{label} ({count})</h3>{count > rows.length && <p>Se muestran las 200 más recientes de este grupo.</p>}<ul>{rows.map(company => <li key={company.id}><Link className="underline" prefetch={false} href={`/empresas/${company.id}`}>{company.name}</Link> · {company.city ?? 'Ubicación por verificar'} · {company.source} · {company.researchQueuedAt ? 'Investigación en cola' : status === 'PENDING' ? 'Revisión humana requerida' : 'Sin investigación pendiente'} {company.sourceIdentities.filter(source => source.attribution).map(source => <a key={source.id} className="ml-2 underline" href="https://www.openstreetmap.org/copyright">{source.attribution}</a>)}</li>)}</ul></section>;
      })}
    </section>
    <section aria-label="Historial de ejecuciones" className="overflow-x-auto rounded bg-white p-4"><h2 className="text-lg font-semibold">Historial de ejecuciones</h2>
      <table className="w-full text-left"><thead><tr>{['Perfil / fuente', 'Inicio / fin', 'Estado', 'Candidatas', 'Nuevas', 'Duplicadas', 'Suprimidas', 'Errores', 'Consultas / coincidencias'].map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{runs.map(run => <tr key={run.id}><td>{run.profile.name} · {run.source}</td><td>{run.startedAt.toISOString()}<br/>{run.finishedAt?.toISOString() ?? 'En curso'}</td><td>{run.status}</td><td>{run.candidates}</td><td>{run.created}</td><td>{run.duplicates}</td><td>{run.suppressed}</td><td>{run.errors}</td><td><details><summary>Ver registro</summary><pre className="whitespace-pre-wrap text-xs">{JSON.stringify({ queries: run.queries, matches: run.matches, errors: run.errorCodes }, null, 2)}</pre></details></td></tr>)}</tbody>
      </table>
    </section>
  </main>;
}
