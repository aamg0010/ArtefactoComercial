import Image from 'next/image';
import { signIn } from '@/auth';

export default function Login() {
  return <main className="relative flex min-h-[calc(100vh-9rem)] items-center justify-center overflow-hidden px-5 py-12">
    <div aria-hidden className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-try-200/50 blur-3xl" />
    <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-lima-300/40 blur-3xl" />
    <div className="relative grid w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl md:grid-cols-2">
      <section className="hidden flex-col justify-between bg-gradient-to-br from-try-500 via-try-600 to-try-900 p-10 text-white md:flex">
        <Image src="/brand/try-company-blanco.png" alt="try! company" width={180} height={96} className="h-auto w-40" />
        <div>
          <p className="font-display text-3xl font-semibold leading-tight">Encuentra, estudia y acompaña a cada empresa.</p>
          <p className="mt-4 font-serif text-lg text-try-100">Rastreo, guiones, llamadas, emails y seguimiento diario, conectado con trygestión.</p>
        </div>
        <p className="font-display text-xs uppercase tracking-[0.2em] text-lima-300">try! Comercial</p>
      </section>
      <section className="p-8 sm:p-10">
        <Image src="/brand/try-company.png" alt="" width={120} height={64} className="mb-6 h-auto w-28 md:hidden" />
        <h1>try! Comercial</h1>
        <p className="mt-2 font-display text-sm text-slate-500">Accede con tus credenciales.</p>
        <form className="mt-8 space-y-5" action={async (formData) => { 'use server'; await signIn('credentials', { email: formData.get('email'), password: formData.get('password'), redirectTo: '/' }); }}>
          <label className="block">Email<input name="email" type="email" autoComplete="username" required /></label>
          <label className="block">Contraseña<input name="password" type="password" autoComplete="current-password" required /></label>
          <button type="submit" className="w-full py-2.5">Entrar</button>
        </form>
      </section>
    </div>
  </main>;
}
