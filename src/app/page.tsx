import Link from 'next/link';
import { auth, signOut } from '@/auth';
import { prisma } from '@/lib/prisma';
import { createCompany, createContact } from './actions';
import { importCompaniesAction as importCompanies } from './import-action';

const legalBases = ['LEGITIMATE_INTEREST', 'CONSENT', 'CONTRACT', 'PENDING'] as const;
export default async function Home({ searchParams }: { searchParams: { q?: string } }) {
  const session = await auth();
  const q = searchParams.q?.trim();
  const companies = await prisma.company.findMany({ where: q ? { name: { contains: q, mode: 'insensitive' } } : undefined, include: { contacts: true }, orderBy: { createdAt: 'desc' }, take: 100 });
  return <main className="mx-auto max-w-6xl p-5">
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
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Empresas ({companies.length})</h2><form><input className="w-64" name="q" defaultValue={q} placeholder="Buscar empresa" /><button className="ml-2">Buscar</button></form></div>
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm">
        <thead className="border-b"><tr><th className="p-2">Empresa</th><th>Ubicación</th><th>Sector</th><th>Origen</th><th>Contactos</th></tr></thead>
        <tbody>{companies.map(company => <tr className="border-b" key={company.id}>
          <td className="p-2 font-medium"><Link className="font-medium hover:underline" href={`/empresas/${company.id}`}>{company.name}</Link>{company.fictional && <span className="ml-2 badge badge-warning">Ficticia</span>}</td>
          <td>{company.city}, {company.country}</td><td>{company.sector ?? '—'}</td><td>{company.source}</td>
          <td><details><summary>{company.contacts.length}</summary><ul>{company.contacts.map(contact => <li key={contact.id}>{contact.fullName} · {contact.email ?? 'sin email'}</li>)}</ul>
            <form action={createContact} className="mt-2 grid gap-2"><input type="hidden" name="companyId" value={company.id}/><input name="fullName" placeholder="Nombre contacto" required /><input name="role" placeholder="Cargo"/><input name="email" type="email" placeholder="Email"/><input name="phone" placeholder="Teléfono"/><select name="legalBasis">{legalBases.map(base => <option key={base}>{base}</option>)}</select><label className="text-xs"><input className="mr-1 w-auto" name="requiresConsent" type="checkbox"/>Requiere consentimiento</label><button>Añadir contacto</button></form>
          </details></td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </main>;
}
