import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { safeId } from '@/lib/mi-dia/script-email';
import { loadContactHistory } from '@/lib/contact-history-service';
import { contactHistoryCsv, historyMedia } from '@/lib/contact-history';

export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return new Response('No autenticado', { status: 401 });
  if (!safeId.safeParse(params.id).success) return new Response('Identificador inválido', { status: 400 });
  if (!await prisma.company.findUnique({ where: { id: params.id }, select: { id: true } })) return new Response('Empresa no encontrada', { status: 404 });
  const medium = new URL(request.url).searchParams.get('medio') ?? 'Todos';
  if (!historyMedia.includes(medium as typeof historyMedia[number])) return new Response('Medio inválido', { status: 400 });
  return new Response(contactHistoryCsv(await loadContactHistory(prisma, params.id, medium)), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="historial-${params.id}.csv"`, 'Cache-Control': 'private, no-store' } });
}
