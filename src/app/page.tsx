import Link from 'next/link';
import { auth, signOut } from '@/auth';
import { prisma } from '@/lib/prisma';
import { createCompany } from './actions';
import { importCompaniesAction as importCompanies } from './import-action';

export default async function Home({ searchParams }: { searchParams: { q?: string } }) {
  const session = await auth();
  const q = searchParams.q?.trim();
  const companies = await prisma.company.findMany({ where: q ? { name: { contains: q, mode: 'insensitive' } } : undefined, include: { contacts: true }, orderBy: { createdAt: 'desc' }, take: 100 });
  return <main className="mx-auto max-w-6xl p-3 sm:p-5">
    <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="page-title">Empresas</h1><p className="page-subtitle mb-0">Base comercial de prospectos y clientes</p></div>
      <form action={async () => { 'use server'; await signOut({ redirectTo: '/login' }); }}><span className="mr-3 font-display text-sm text-slate-500">{session?.user?.email}</span><button className="btn-secondary">Cerrar sesión</button></form>
    </header>
    <section className="grid gap-5 lg:grid-cols-2">
      <div className="card"><h2 className="font-semibold">Nueva empresa</h2>
        <form action={createCompany} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label>Nombre<input name="name" required /></label><label>País<select name="country"><option value="ES">España</option><option value="CO">Colombia</option></select></label>
          <label>Región<input name="region" /></label><label>Ciudad<input name="city" /></label><label>Sector<input name="sector" /></label><label>NIF/NIT<input name="nifNit" /></label><label>Web<input name="website" /></label><label>Email<input name="email" type="email" /></label><label>Teléfono<input name="phone" /></label>
          <div className="sm:col-span-2"><button>Guardar empresa</button></div>
        </form>
      </div>
      <div className="card"><h2 className="font-semibold">Importar CSV</h2><p className="mt-2 text-sm text-slate-600">Columnas: nombre, pais (ES/CO), nifNit, web, email, telefono, region, ciudad, sector, contacto, cargo, emailContacto.</p>
        <form action={importCompanies} className="mt-4 space-y-3"><input name="file" type="file" accept=".csv,text/csv" required /><button>Importar y deduplicar</button></form>
        <a className="mt-3 block text-sm text-try-600 hover:underline" href="/ejemplo-importacion.csv">Descargar ejemplo CSV</a>
      </div>
    </section>
    <section className="mt-7 rounded-lg bg-white p-5 shadow">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Empresas ({companies.length})</h2><form><input className="w-full sm:w-64" name="q" defaultValue={q} placeholder="Buscar empresa" /><button className="ml-2">Buscar</button></form></div>
      <p className="mt-2 text-sm text-slate-500">Los contactos se añaden, editan y borran dentro de la ficha de cada empresa.</p>
      <ul className="mt-4 divide-y md:hidden">{companies.map(company => <li className="py-3" key={company.id}>
        <Link className="font-semibold text-try-700 hover:underline [overflow-wrap:anywhere]" href={`/empresas/${company.id}`}>{company.name}</Link>{company.fictional && <span className="ml-2 badge badge-warning">Ficticia</span>}
        <p className="text-sm text-slate-600">{[company.city ?? 'Municipio por verificar', company.country].join(', ')} · {company.sector ?? 'Sector pendiente'}</p>
        <p className="text-sm">{company.phone && <a className="mr-3 font-medium text-try-700" href={`tel:${company.phone.replace(/[^\d+]/g, '')}`}>{company.phone}</a>}<span className="text-slate-500">{company.contacts.length} contacto{company.contacts.length === 1 ? '' : 's'}</span></p>
      </li>)}</ul>
      <div className="mt-4 hidden overflow-x-auto md:block"><table className="w-full text-left text-sm">
        <thead className="border-b"><tr><th className="p-2">Empresa</th><th>Ubicación</th><th>Sector</th><th>Teléfono</th><th>Email</th><th>Contactos</th></tr></thead>
        <tbody>{companies.map(company => <tr className="border-b" key={company.id}>
          <td className="p-2 font-medium"><Link className="font-medium hover:underline" href={`/empresas/${company.id}`}>{company.name}</Link>{company.fictional && <span className="ml-2 badge badge-warning">Ficticia</span>}</td>
          <td>{company.city ?? 'Por verificar'}, {company.country}</td><td>{company.sector ?? '—'}</td>
          <td>{company.phone ? <a className="text-try-700 hover:underline" href={`tel:${company.phone.replace(/[^\d+]/g, '')}`}>{company.phone}</a> : '—'}</td>
          <td className="[overflow-wrap:anywhere]">{company.email ? <a className="text-try-700 hover:underline" href={`mailto:${company.email}`}>{company.email}</a> : '—'}</td>
          <td><Link className="text-try-700 hover:underline" href={`/empresas/${company.id}#contactos`}>{company.contacts.length}</Link></td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </main>;
}
