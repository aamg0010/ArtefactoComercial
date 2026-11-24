import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), mutate: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/guia/mutations', () => ({ mutateGuide: mocks.mutate }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { guideAction } from './guide-actions';

beforeEach(() => vi.clearAllMocks());
it.each(['postpone', 'next', 'pause'])('%s exige sesión y rechaza DIRECTOR antes de escribir', async action => {
  const form = new FormData(); form.set('action', action);
  mocks.auth.mockResolvedValue(null);
  await expect(guideAction(form)).rejects.toThrow('No autorizado');
  mocks.auth.mockResolvedValue({ user: { id: 'director-legible', role: 'DIRECTOR' } });
  await expect(guideAction(form)).rejects.toThrow('No autorizado');
  expect(mocks.mutate).not.toHaveBeenCalled();
});
it('usa el usuario de sesión y actualiza el menú y las fichas tras guardar', async () => {
  mocks.auth.mockResolvedValue({ user: { id: 'sales-legible', role: 'SALES' } });
  const form = new FormData(); form.set('action', 'next'); form.set('userId', 'suplantado');
  await guideAction(form);
  expect(mocks.mutate).toHaveBeenCalledWith({}, { action: 'next', userId: 'sales-legible' });
  expect(mocks.revalidate).toHaveBeenCalledWith('/', 'layout');
});
