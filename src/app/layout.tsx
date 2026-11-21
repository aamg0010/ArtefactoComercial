import './globals.css';
import Link from 'next/link';
import { llmConfiguration } from '@/lib/llm';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'try! Comercial', description: 'Gestión comercial try! company' };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="es"><body><nav aria-label="Menú principal" className="flex flex-wrap gap-5 bg-white p-4"><Link href="/">Empresas</Link><Link href="/mi-dia">Mi día</Link><Link href="/pipeline">Pipeline</Link><Link href="/rastreo">Rastreo</Link></nav>{llmConfiguration().simulated && <p role="status" className="bg-amber-100 p-3">IA en modo simulado</p>}{children}</body></html>; }
