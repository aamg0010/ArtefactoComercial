import { loadContactStatuses } from '@/lib/contact-status-service';
import { ContactBadge } from '@/app/contact-status';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { pipelineStages } from '@/lib/email-replies';
import { trygestionEmpresaUrl } from '@/lib/trygestion/links';
import { ReplyCards } from './reply-cards';

export const dynamic = 'force-dynamic';

export default async function Pipeline({ searchParams }: { searchParams: { gestionadas?: string } }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const canEdit = Boolean(session.user.id) && session.user.role !== 'DIRECTOR';
  const replies = await prisma.emailReply.findMany({ where: { status: 'NEW' }, include: { company: true }, orderBy: { receivedAt: 'desc' } });
  const handled = searchParams.gestionadas === '1' ? await prisma.emailReply.findMany({
    where: { status: 'HANDLED', handledAt: { gte: new Date(Date.now() - 30 * 86400000) } },
    include: { company: true }, orderBy: { handledAt: 'desc' },
  }) : [];
  const companies = await prisma.company.findMany({ orderBy: { priority: 'asc' } });
  const statuses = await loadContactStatuses(prisma, companies.map(c => c.id));
  const repliedCompanies = new Set(replies.map(reply => reply.companyId));
  return <main className="mx-auto max-w-7xl p-5">
    <h1 className="page-title">Pipeline</h1>
    {replies.length > 0 && <section aria-label="Respuestas nuevas" className="mt-4 rounded-xl border-2 border-try-500 bg-try-50 p-3">
      <h2 className="text-lg font-semibold">Respuestas nuevas ({replies.length})</h2>
      <ReplyCards replies={replies} canEdit={canEdit}/>
    </section>}
    <Link className="my-4 inline-block underline" href={searchParams.gestionadas === '1' ? '/pipeline' : '/pipeline?gestionadas=1'}>{searchParams.gestionadas === '1' ? 'Ocultar respuestas gestionadas' : 'Ver respuestas gestionadas'}</Link>
    {searchParams.gestionadas === '1' && <section aria-label="Respuestas gestionadas">
      <h2>Respuestas gestionadas (últimos 30 días)</h2><ReplyCards replies={handled} canEdit={false}/>
      {!handled.length && <p>No hay respuestas gestionadas recientes.</p>}
    </section>}
    <div className="mt-5 grid grid-flow-col auto-cols-[16rem] gap-3 overflow-x-auto">{pipelineStages.map(([stage, label]) => <section aria-label={label} className="rounded-2xl border border-try-100 bg-try-50/60 p-3" key={stage}>
      <h2 className="flex items-center justify-between font-display text-sm font-semibold uppercase tracking-wide text-try-800">{label}<span className="badge badge-b">{companies.filter(company => company.pipelineStage === stage).length}</span></h2>
      {companies.filter(company => company.pipelineStage === stage).map(company => <article className="mt-2 rounded-xl border border-slate-200 bg-white p-3 shadow-card" key={company.id}>
        <Link href={`/empresas/${company.id}`}><span className={`badge badge-${(company.priority ?? 'C').toLowerCase()} mr-2`}>{company.priority ?? 'C'}</span><span className="font-display text-sm font-medium text-slate-800">{company.name}</span></Link>
        <ContactBadge status={statuses.get(company.id)!}/>
        {repliedCompanies.has(company.id) && <span className="badge badge-a mt-2">Respondió</span>}
        {company.trygestionEmpresaId && <a className="mt-2 block font-display text-xs text-try-500 hover:text-try-700" href={trygestionEmpresaUrl(company.trygestionEmpresaId)} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${company.name} en trygestión`}>trygestión ↗</a>}
      </article>)}
    </section>)}</div>
  </main>;
}
