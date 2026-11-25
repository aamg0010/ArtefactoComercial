import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), revalidate: vi.fn(), redirect: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: vi.fn() } }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
import { deleteCompanyAction } from './delete-action';
import { prisma } from '@/lib/prisma';

beforeEach(() => vi.clearAllMocks());
it('exige sesión, rechaza DIRECTOR y confirmación ausente incluso con POST directo', async () => {
  const form = new FormData(); form.set('companyId', 'empresa-legible');
  mocks.auth.mockResolvedValue(null);
  await expect(deleteCompanyAction(form)).rejects.toThrow('No autorizado');
  mocks.auth.mockResolvedValue({ user: { id: 'director', role: 'DIRECTOR' } });
  form.set('confirmed', 'on');
  await expect(deleteCompanyAction(form)).rejects.toThrow('No autorizado');
  mocks.auth.mockResolvedValue({ user: { id: 'sales', role: 'SALES' } });
  form.delete('confirmed');
  await expect(deleteCompanyAction(form)).rejects.toThrow('Confirma');
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
it.each([true, false])('redirige a Empresas con mensaje e invalida Mi día (borrada=%s)', async deleted => {
  mocks.auth.mockResolvedValue({ user: { id: 'sales', role: 'SALES' } });
  vi.mocked(prisma.$transaction).mockResolvedValue(deleted ? { deleted: true, name: 'Empresa & ejemplo' } : { deleted: false });
  const form = new FormData(); form.set('companyId', 'empresa-legible'); form.set('confirmed', 'on');
  await deleteCompanyAction(form);
  expect(mocks.revalidate).toHaveBeenCalledWith('/mi-dia');
  expect(mocks.revalidate).toHaveBeenCalledWith('/empresas/empresa-legible');
  const target = mocks.redirect.mock.calls[0][0] as string;
  expect(new URL(target, 'http://localhost').searchParams.get('mensaje')).toBe(deleted ? 'Empresa Empresa & ejemplo eliminada' : 'La empresa ya estaba eliminada');
});
