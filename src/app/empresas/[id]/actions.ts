'use server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { investigateCompany, generateCompanyScript, approveCompanyScript, applySuggestedPriority } from '@/lib/research/service';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

export async function companyAction(form: FormData) {
  const session = await auth();
  if (!session?.user?.id || session.user.role === 'DIRECTOR') throw new Error('No autorizado');
  const companyId = z.string().cuid().parse(form.get('companyId'));
  const action = z.enum(['research', 'priority', 'generate', 'approve']).parse(form.get('action'));
  let failed = false;
  try {
    if (action === 'research') await investigateCompany(prisma, companyId);
    if (action === 'priority') await applySuggestedPriority(prisma, companyId, session.user.id);
    if (action === 'generate') await generateCompanyScript(prisma, companyId, z.string().min(1).parse(form.get('product')));
    if (action === 'approve') {
      const scriptId = z.string().cuid().parse(form.get('scriptId'));
      await prisma.script.findFirstOrThrow({ where: { id: scriptId, companyId } });
      await approveCompanyScript(prisma, scriptId, session.user.id);
    }
  } catch { failed = true; }
  revalidatePath(`/empresas/${companyId}`);
  revalidatePath('/mi-dia'); revalidatePath('/pipeline'); revalidatePath('/');
  redirect(`/empresas/${companyId}?${failed ? 'error=1' : 'done=1'}`);
}
