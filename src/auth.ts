import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import type { Provider } from 'next-auth/providers';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { compare } from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authConfig } from './auth.config';

const providers: Provider[] = [Credentials({ name: 'Acceso de desarrollo', credentials: { email: { label: 'Email', type: 'email' }, password: { label: 'Contraseña', type: 'password' } }, async authorize(input) { const data = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(input); const user = await prisma.user.findUnique({ where: { email: data.email } }); if (!user?.passwordHash || !(await compare(data.password, user.passwordHash))) return null; return { id: user.id, email: user.email, name: user.name, role: user.role }; } })];
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) providers.push(Google({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }));
export const { handlers, auth, signIn, signOut } = NextAuth({ ...authConfig, adapter: PrismaAdapter(prisma), providers, callbacks: { ...authConfig.callbacks, jwt({ token, user }) { if (user) token.role = user.role; return token; }, session({ session, token }) { if (session.user) { session.user.id = token.sub ?? ''; session.user.role = token.role as string; } return session; } } });
export const { GET, POST } = handlers;
