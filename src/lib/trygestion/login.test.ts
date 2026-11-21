import { expect, it, vi } from 'vitest';
import { loginConTrygestion, roleFor, loginBlocked, registerLoginFailure, clearLoginFailures, authMode } from './login';

const env = { TRYGESTION_URL: 'https://trygestion.test/gestion/api/', TRYGESTION_TENANT_ID: 'tenant-try-legacy' };
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const usuario = (extra: Record<string, unknown> = {}) => ({ id: 'u-1', nombre: 'Ana Comercial', email: 'Ana@Try.Test', rol: 'empleado', rol_efectivo: 'empleado', ...extra });

it('valida contra /auth/login, exige el tenant TRY y cierra la sesión de trygestión', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(ok({ token: 'token-de-sesion-123', usuario: usuario(), tenants: [{ id: 'tenant-try-legacy', nombre: 'TRY Business Solutions S.L.', rol_tenant: 'miembro' }] })).mockResolvedValue(ok({}));
  const result = await loginConTrygestion('ana@try.test', 'secreto', { env, fetcher });
  expect(result).toEqual({ ok: true, email: 'ana@try.test', name: 'Ana Comercial', role: 'SALES', trygestionUserId: 'u-1', tenant: 'TRY Business Solutions S.L.' });
  expect(fetcher.mock.calls[0][0]).toBe('https://trygestion.test/gestion/api/auth/login');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ email: 'ana@try.test', password: 'secreto' });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(fetcher.mock.calls[1][0]).toBe('https://trygestion.test/gestion/api/auth/logout');
  expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer token-de-sesion-123');
});

it('CEO (global, efectivo o del tenant) es administración; el resto, comercial', async () => {
  expect(roleFor({ rol: 'ceo' })).toBe('ADMIN');
  expect(roleFor({ rol: 'empleado', rol_efectivo: 'ceo' })).toBe('ADMIN');
  expect(roleFor({ rol: 'empleado' }, 'ceo')).toBe('ADMIN');
  expect(roleFor({ rol: 'contable' }, 'miembro')).toBe('SALES');
  const fetcher = vi.fn().mockResolvedValueOnce(ok({ token: 'token-de-sesion-456', usuario: usuario({ rol: 'ceo' }), tenants: [{ id: 'tenant-try-legacy', rol_tenant: 'miembro' }] })).mockResolvedValue(ok({}));
  expect(await loginConTrygestion('ana@try.test', 'x', { env, fetcher })).toMatchObject({ ok: true, role: 'ADMIN' });
});

it('rechaza a quien no está en el tenant TRY, credenciales malas y caídas de trygestión', async () => {
  const otroTenant = vi.fn().mockResolvedValueOnce(ok({ token: 'token-de-sesion-789', usuario: usuario({ rol: 'ceo' }), tenants: [{ id: 'tenant-cliente', rol_tenant: 'ceo' }] })).mockResolvedValue(ok({}));
  expect(await loginConTrygestion('a@b.test', 'x', { env, fetcher: otroTenant })).toEqual({ ok: false, reason: 'NOT_IN_TENANT' });
  expect(await loginConTrygestion('a@b.test', 'x', { env, fetcher: vi.fn().mockResolvedValue(new Response('{"error":"Credenciales"}', { status: 401 })) })).toEqual({ ok: false, reason: 'INVALID_CREDENTIALS' });
  expect(await loginConTrygestion('a@b.test', 'x', { env, fetcher: vi.fn().mockRejectedValue(new Error('timeout')) })).toEqual({ ok: false, reason: 'UNAVAILABLE' });
  expect(await loginConTrygestion('a@b.test', 'x', { env, fetcher: vi.fn().mockResolvedValue(ok({ algo: 'raro' })) })).toEqual({ ok: false, reason: 'UNAVAILABLE' });
  expect(await loginConTrygestion('a@b.test', 'x', { env: {} })).toEqual({ ok: false, reason: 'NOT_CONFIGURED' });
});

it('bloquea 15 minutos tras 5 fallos y el modo por defecto es local', () => {
  const now = 1_000_000;
  for (let i = 0; i < 5; i++) registerLoginFailure('x@y.test', now);
  expect(loginBlocked('x@y.test', now + 1000)).toBe(true);
  expect(loginBlocked('x@y.test', now + 16 * 60_000)).toBe(false);
  clearLoginFailures('x@y.test'); expect(loginBlocked('x@y.test', now)).toBe(false);
  expect(authMode({})).toBe('local'); expect(authMode({ AUTH_MODE: 'trygestion' })).toBe('trygestion');
});
