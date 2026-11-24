'use server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { mutateGuide } from '@/lib/guia/mutations';
import { revalidatePath } from 'next/cache';

export async function guideAction(form: FormData) {
  const session = await auth();
  if (!session?.user?.id || session.user.role === 'DIRECTOR') throw new Error('No autorizado');
  await mutateGuide(prisma, { ...Object.fromEntries(form), userId: session.user.id });
  revalidatePath('/', 'layout');
}
