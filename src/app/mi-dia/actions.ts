'use server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { completeTask } from '@/lib/tasks';
import { revalidatePath } from 'next/cache';
export async function recordTaskResult(formData: FormData) { const session = await auth(); await completeTask(prisma, String(formData.get('taskId')), String(formData.get('result')), session?.user?.id); revalidatePath('/mi-dia'); }
