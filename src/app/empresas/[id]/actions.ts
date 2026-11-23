'use server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { investigateCompany, generateCompanyScript, approveCompanyScript, applySuggestedPriority } from '@/lib/research/service';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { acceptCompany, discardCompany, verifyProposal } from '@/lib/prospecting/acceptance';

export async function companyAction(form: FormData) {
  const session = await auth();
  if (!session?.user?.id || session.user.role === 'DIRECTOR') throw new Error('No autorizado');
  const companyId = z.string().trim().min(1).max(191).regex(/^[\w-]+$/).parse(form.get('companyId'));
  const action = z.enum(['research', 'priority', 'generate', 'approve', 'accept', 'discard']).parse(form.get('action'));
  let targetId = companyId;
  let failed = false;
  try {
    if (action === 'accept') targetId = await acceptCompany(prisma, companyId, { name: form.get('name'), city: form.get('city'), website: form.get('website'), phone: form.get('phone'), email: form.get('email'), confirmed: form.get('confirmed') === 'on' }, session.user.id, verifyProposal(String(form.get('proof') ?? ''), companyId));
    if (action === 'discard') await discardCompany(prisma, companyId, session.user.id);
    if (action === 'research') await investigateCompany(prisma, companyId);
    if (action === 'priority') await applySuggestedPriority(prisma, companyId, session.user.id);
    if (action === 'generate') await generateCompanyScript(prisma, companyId, z.string().min(1).parse(form.get('product')));
    if (action === 'approve') {
      const scriptId = z.string().trim().min(1).max(191).regex(/^[\w-]+$/).parse(form.get('scriptId'));
      await prisma.script.findFirstOrThrow({ where: { id: scriptId, companyId } });
      await approveCompanyScript(prisma, scriptId, session.user.id);
    }
  } catch { failed = true; }
  revalidatePath(`/empresas/${companyId}`);
  revalidatePath('/mi-dia'); revalidatePath('/pipeline'); revalidatePath('/'); revalidatePath('/rastreo');
  redirect(`/empresas/${targetId}?${failed ? 'error=1' : 'done=1'}`);
}
