'use server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { completeCompanyWebsite, completionFields } from '@/lib/prospecting/complete-web';
import { safeCompanyId } from '@/lib/prospecting/acceptance';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function completeWebAction(form: FormData) {
  const session = await auth();
  if (!session?.user?.id || session.user.role === 'DIRECTOR') throw new Error('No autorizado');
  const id = safeCompanyId.parse(form.get('companyId'));
  try {
    await completeCompanyWebsite(prisma, id, {
      website: form.get('website'), phone: form.get('phone'), email: form.get('email'),
      confirmed: form.get('confirmed') === 'on', replace: completionFields.filter(field => form.get(`replace-${field}`) === 'on'),
    }, String(form.get('proof') ?? ''), session.user);
  } catch { redirect(`/empresas/${id}?error=completar-web`); }
  for (const path of [`/empresas/${id}`, '/', '/mi-dia', '/pipeline', '/rastreo']) revalidatePath(path);
  redirect(`/empresas/${id}?ok=datos-completados#datos-completados`);
}
