'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { deleteCompany } from '@/lib/company-delete';

export async function deleteCompanyAction(form: FormData) {
  const session = await auth();
  const result = await deleteCompany(prisma, {
    companyId: String(form.get('companyId') ?? ''), confirmed: form.get('confirmed') === 'on',
    user: session?.user?.id ? { id: session.user.id, role: session.user.role ?? 'SALES' } : null,
  });
  revalidatePath('/'); revalidatePath('/mi-dia'); revalidatePath('/pipeline');
  revalidatePath(`/empresas/${String(form.get('companyId'))}`);
  redirect(`/?${new URLSearchParams({ mensaje: result.deleted ? `Empresa ${result.name} eliminada` : 'La empresa ya estaba eliminada' })}`);
}
