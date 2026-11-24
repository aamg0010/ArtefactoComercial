import './globals.css';
import Image from 'next/image';
import Link from 'next/link';
import { DM_Serif_Display, Poppins } from 'next/font/google';
import { llmConfiguration } from '@/lib/llm';
import { MainNav } from './main-nav';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { loadGuide } from '@/lib/guia/service';
import { Suspense } from 'react';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'try! Comercial', description: 'Gestión comercial de try! company' };

// Tipografías de la marca (las mismas que trygestión).
const display = Poppins({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-display', display: 'swap' });
const serif = DM_Serif_Display({ subsets: ['latin'], weight: ['400'], variable: '--font-serif', display: 'swap' });

export default async function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  const simulated = llmConfiguration().simulated;
  const session = await auth();
  const important = session?.user?.id ? (await loadGuide(prisma, { userId: session.user.id, role: session.user.role ?? 'SALES' })).important : 0;
  const teamImportant = session?.user?.id && session.user.role === 'ADMIN' ? (await loadGuide(prisma, { userId: session.user.id, role: 'ADMIN', team: true })).important : undefined;
  return <html lang="es" className={`${display.variable} ${serif.variable}`}>
    <body>
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <Link href="/" className="flex items-center gap-3" aria-label="try! Comercial, inicio">
            <Image src="/brand/try-company.png" alt="try! company" width={96} height={51} priority className="h-9 w-auto" />
            <span className="hidden border-l border-slate-200 pl-3 font-display text-sm font-semibold tracking-wide text-try-900 sm:inline">Comercial</span>
          </Link>
          <Suspense><MainNav important={important} teamImportant={teamImportant}/></Suspense>
        </div>
        {simulated && <div className="border-t border-amber-100 bg-amber-50"><p role="status" className="mx-auto max-w-7xl rounded-none border-0 bg-transparent px-5 py-1.5 font-display text-xs text-amber-800">IA en modo simulado</p></div>}
      </header>
      {children}
      <footer className="mx-auto mt-10 flex max-w-7xl items-center justify-between gap-3 border-t border-slate-200 px-5 py-5 font-display text-xs text-slate-400">
        <span>try! company · Gestión comercial</span>
        <span className="flex items-center gap-1">Conectado con <span className="font-semibold text-try-500">trygestión</span></span>
      </footer>
    </body>
  </html>;
}
