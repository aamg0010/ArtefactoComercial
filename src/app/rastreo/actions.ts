'use server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { profileSchema } from '@/lib/prospecting/profiles';
import { runProspecting } from '@/lib/prospecting/service';
import { csvCandidates } from '@/lib/sources/csv';
import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

const list = (form: FormData, key: string) => String(form.get(key) ?? '').split(/[;,\n]/).map(item => item.trim()).filter(Boolean);
export async function prospectingAction(form: FormData) {
  const session = await auth();
  if (!session?.user?.id || session.user.role === 'DIRECTOR') throw new Error('No autorizado');
  const action = z.enum(['save', 'toggle', 'run']).parse(form.get('action'));
  let failed = false;
  let runIds: string[] = [];
  try {
    if (action !== 'run' && session.user.role !== 'ADMIN') throw new Error('Sólo administración puede configurar perfiles');
    const id = String(form.get('profileId') ?? '');
    if (action === 'save') {
      const sources = [...new Set(form.getAll('sources').map(String))];
      const input = profileSchema.parse({ name: form.get('name'), active: form.get('active') === 'on', country: form.get('country'),
        provinces: list(form, 'provinces'), comarcas: list(form, 'comarcas'), municipalities: list(form, 'municipalities'), keywords: list(form, 'keywords'),
        cnaeCodes: list(form, 'cnaeCodes'), productLine: form.get('productLine'), source: sources[0], sources, maxResults: Number(form.get('maxResults')) });
      await prisma.product.findFirstOrThrow({ where: { line: input.productLine, active: true } });
      const csv = String(form.get('csv') ?? '');
      if (input.sources.includes('csv') && !csv && !id) throw new Error('Falta CSV');
      const data = { ...input, ...(input.sources.includes('csv') && csv ? { csvCandidates: JSON.parse(JSON.stringify(csvCandidates(csv))) as Prisma.InputJsonValue } : {}) };
      if (id) await prisma.searchProfile.update({ where: { id }, data });
      else await prisma.searchProfile.create({ data });
    } else if (action === 'toggle') {
      const profile = await prisma.searchProfile.findUniqueOrThrow({ where: { id } });
      await prisma.searchProfile.update({ where: { id }, data: { active: !profile.active } });
    } else {
      if (!id) throw new Error('Falta perfil');
      runIds = (await runProspecting(id, { db: prisma })).map(run => run.id);
    }
    await prisma.auditLog.create({ data: { userId: session.user.id, entityType: 'SearchProfile', entityId: id || 'new', action: action.toUpperCase() } });
  } catch { failed = true; }
  revalidatePath('/rastreo'); revalidatePath('/');
  // Tras «Ejecutar ahora» la página muestra el resumen de esa ejecución.
  redirect(`/rastreo?${failed ? 'error=1' : 'done=1'}${runIds.length ? `&ejecucion=${runIds.join(',')}` : ''}`);
}
