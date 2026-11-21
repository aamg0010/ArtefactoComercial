import { prisma } from '@/lib/prisma';
import { readUnsubscribeToken, unsubscribeCompany } from '@/lib/trygestion/email';
import { redirect } from 'next/navigation';
export default function UnsubscribePage({ params, searchParams }: { params: { token: string }; searchParams: { done?: string } }) {
  const valid = readUnsubscribeToken(params.token);
  async function confirm() { 'use server'; await unsubscribeCompany(prisma, params.token); redirect(`/baja/${params.token}?done=1`); }
  return <main className="p-5"><h1>Baja de comunicaciones comerciales</h1>{!valid ? <p>El enlace no es válido o ha caducado.</p> : searchParams.done ? <p role="status">Baja registrada. No recibirás nuevas comunicaciones.</p> : <form action={confirm}><p>Confirma que deseas dejar de recibir comunicaciones de try! company.</p><button>Confirmar baja</button></form>}</main>;
}
