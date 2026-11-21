import type { NextAuthConfig } from 'next-auth';

// Shared with Edge middleware; keep database adapters out of this module.
export const authConfig = {
  providers: [],
  // Sesiones de 12 h: si alguien deja de estar en trygestión, pierde el acceso en la misma jornada.
  session: { strategy: 'jwt', maxAge: 12 * 60 * 60 },
  pages: { signIn: '/login' },
  callbacks: {
    authorized({ auth, request }) {
      return request.nextUrl.pathname === '/login' || request.nextUrl.pathname.startsWith('/baja/') || Boolean(auth?.user);
    },
  },
} satisfies NextAuthConfig;
