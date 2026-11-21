import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import type { Provider } from 'next-auth/providers';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { compare } from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authConfig } from './auth.config';
import { authMode, clearLoginFailures, loginBlocked, loginConTrygestion, registerLoginFailure } from '@/lib/trygestion/login';

const credentialsInput = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(500) });

/** Producción (AUTH_MODE=trygestion): cada persona entra con su usuario de trygestión. Desarrollo y tests: usuarios locales. */
async function authorize(input: unknown) {
  const parsed = credentialsInput.safeParse(input); if (!parsed.success) return null;
  const { email, password } = parsed.data;
  if (loginBlocked(email)) return null;
  if (authMode() === 'trygestion') {
    const result = await loginConTrygestion(email, password);
    if (!result.ok) { if (result.reason === 'INVALID_CREDENTIALS' || result.reason === 'NOT_IN_TENANT') registerLoginFailure(email); return null; }
    clearLoginFailures(email);
    // El rol se recalcula en cada acceso desde trygestión; no se guarda ninguna contraseña.
    const user = await prisma.user.upsert({ where: { email: result.email }, update: { name: result.name, role: result.role }, create: { email: result.email, name: result.name, role: result.role } });
    await prisma.auditLog.create({ data: { userId: user.id, entityType: 'User', entityId: user.id, action: 'LOGIN_TRYGESTION', metadata: { role: result.role, trygestionUserId: result.trygestionUserId } } }).catch(() => {});
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash || !(await compare(password, user.passwordHash))) { registerLoginFailure(email); return null; }
  clearLoginFailures(email);
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

const providers: Provider[] = [Credentials({ name: 'Usuario', credentials: { email: { label: 'Email', type: 'email' }, password: { label: 'Contraseña', type: 'password' } }, authorize })];
if (authMode() === 'local' && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) providers.push(Google({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }));
export const { handlers, auth, signIn, signOut } = NextAuth({ ...authConfig, adapter: PrismaAdapter(prisma), providers, callbacks: { ...authConfig.callbacks, jwt({ token, user }) { if (user) token.role = user.role; return token; }, session({ session, token }) { if (session.user) { session.user.id = token.sub ?? ''; session.user.role = token.role as string; } return session; } } });
export const { GET, POST } = handlers;
