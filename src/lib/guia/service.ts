import type { Prisma, PrismaClient } from '@prisma/client';
import { buildGuide, type Scope } from './engine';

export const guideInclude = {
  tasks: { include: { cadenceStep: true } }, activities: { select: { createdAt: true, result: true } },
  emailReplies: { select: { id: true, subject: true, status: true, receivedAt: true } }, cadences: true,
  researchReports: { select: { id: true }, take: 1 }, scripts: { select: { status: true } }, suppressions: { select: { id: true } },
} satisfies Prisma.CompanyInclude;
export async function loadGuide(db: PrismaClient, scope: Scope, now = new Date(), day?: string, companyId?: string) {
  const companies = await db.company.findMany({ where: { ...(companyId ? { id: companyId } : {}),
    ...(!(scope.team && scope.role === 'ADMIN') ? { OR: [{ ownerId: scope.userId }, { ownerId: null }, { tasks: { some: { assigneeId: scope.userId } } }] } : {}),
  }, include: guideInclude });
  const orphans = companyId ? [] : await db.emailReply.findMany({ where: { companyId: null, status: 'NEW', receivedAt: { lte: now } }, select: { id: true, subject: true } });
  return buildGuide(companies, scope, now, day, orphans);
}
