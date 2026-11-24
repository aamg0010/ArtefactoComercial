'use server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { handleEmailReply } from '@/lib/email-replies';
import { revalidatePath } from 'next/cache';

export async function handleReply(form: FormData) {
  const session = await auth();
  if (!session?.user?.id || session.user.role === 'DIRECTOR') throw new Error('No autorizado.');
  const reply = await handleEmailReply(prisma, { ...Object.fromEntries(form), userId: session.user.id });
  for (const path of ['/pipeline', '/mi-dia', '/integracion', ...(reply.companyId ? [`/empresas/${reply.companyId}`] : [])]) revalidatePath(path);
}
