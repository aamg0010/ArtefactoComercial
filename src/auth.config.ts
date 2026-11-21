import type { NextAuthConfig } from 'next-auth';

// Shared with Edge middleware; keep database adapters out of this module.
export const authConfig = {
  providers: [],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    authorized({ auth, request }) {
      return request.nextUrl.pathname === '/login' || request.nextUrl.pathname.startsWith('/baja/') || Boolean(auth?.user);
    },
  },
} satisfies NextAuthConfig;
