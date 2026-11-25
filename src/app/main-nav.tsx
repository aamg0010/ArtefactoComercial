'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const items = [
  { href: '/', label: 'Empresas', match: (path: string) => path === '/' || path.startsWith('/empresas') },
  { href: '/mi-dia', label: 'Mi día' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/rastreo', label: 'Rastreo' },
  { href: '/integracion', label: 'Integración' },
];

export function MainNav({ important = 0, ownImportant }: { important?: number; ownImportant?: number }) {
  const path = usePathname() ?? '/';
  const params = useSearchParams();
  const count = path === '/mi-dia' && params.get('equipo') === '0' && ownImportant !== undefined ? ownImportant : important;
  // Páginas públicas (acceso y baja): sin menú.
  if (path.startsWith('/login') || path.startsWith('/baja')) return null;
  return <nav aria-label="Menú principal" className="flex flex-wrap items-center gap-1">
    {items.map(item => {
      const active = item.match ? item.match(path) : path.startsWith(item.href);
      return <Link key={item.href} href={item.href} aria-label={item.label} aria-current={active ? 'page' : undefined}
        className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${active ? 'bg-try-500 text-white shadow-sm hover:text-white' : 'text-slate-600 hover:bg-try-50 hover:text-try-700'}`}>
        {item.label}
        {item.href === '/mi-dia' && <span data-testid="guide-badge" aria-label={`${count} avisos importantes`} className="ml-1 rounded-full bg-amber-100 px-2 text-xs text-amber-900">{count}</span>}
      </Link>;
    })}
  </nav>;
}
