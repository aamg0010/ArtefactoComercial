'use server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { completeTask } from '@/lib/tasks';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { sendTaskEmail } from '@/lib/trygestion/email';
import { TrygestionError } from '@/lib/trygestion/client';
export async function recordTaskResult(formData: FormData) {
  const session = await auth(); if (!session?.user?.id) throw new Error('No autenticado');
  const date = String(formData.get('meetingDate') ?? ''); const time = String(formData.get('meetingTime') ?? '');
  await completeTask(prisma, String(formData.get('taskId')), String(formData.get('result')), session.user.id, date && time ? { date, time, location: String(formData.get('meetingLocation') ?? '') } : undefined);
  revalidatePath('/mi-dia'); revalidatePath('/pipeline');
}
export async function approveEmail(formData: FormData) {
  const session = await auth(); if (!session?.user?.id) throw new Error('No autenticado');
  let code = 'EMAIL_SENT';
  try { await sendTaskEmail(prisma, { taskId: String(formData.get('taskId')), userId: session.user.id, approved: formData.get('approved') === 'on', to: formData.get('to'), subject: formData.get('subject'), body: formData.get('body') }); }
  catch (error) { code = error instanceof TrygestionError ? error.code : 'EMAIL_REVIEW_REQUIRED'; }
  revalidatePath('/mi-dia');
  redirect(`/mi-dia?fecha=${encodeURIComponent(String(formData.get('fecha')))}&email=${encodeURIComponent(code)}`);
}
