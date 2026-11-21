'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/', label: 'Empresas', match: (path: string) => path === '/' || path.startsWith('/empresas') },
  { href: '/mi-dia', label: 'Mi día' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/rastreo', label: 'Rastreo' },
  { href: '/integracion', label: 'Integración' },
];

export function MainNav() {
  const path = usePathname() ?? '/';
  // Páginas públicas (acceso y baja): sin menú.
  if (path.startsWith('/login') || path.startsWith('/baja')) return null;
  return <nav aria-label="Menú principal" className="flex flex-wrap items-center gap-1">
    {items.map(item => {
      const active = item.match ? item.match(path) : path.startsWith(item.href);
      return <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}
        className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${active ? 'bg-try-500 text-white shadow-sm hover:text-white' : 'text-slate-600 hover:bg-try-50 hover:text-try-700'}`}>
        {item.label}
      </Link>;
    })}
  </nav>;
}
