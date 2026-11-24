'use server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { prepareEmailInput, prepareScriptEmail } from '@/lib/mi-dia/prepare-email';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function prepareEmail(form: FormData) {
  const session = await auth();
  if (!session?.user?.id || session.user.role === 'DIRECTOR') throw new Error('No autorizado');
  const input = prepareEmailInput.parse({ companyId: form.get('companyId'), scriptId: form.get('scriptId'), emailIndex: form.get('emailIndex'), userId: session.user.id });
  let task;
  try { task = await prepareScriptEmail(prisma, input); }
  catch { redirect(`/empresas/${input.companyId}?error=email-no-preparado`); }
  revalidatePath('/mi-dia');
  redirect(`/mi-dia?tarea=${task.id}#tarea-${task.id}`);
}
