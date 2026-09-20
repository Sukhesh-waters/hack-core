import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Edge-safe slice of the auth config: no adapter, no database imports.
 * Used by middleware; extended with the Drizzle adapter + Resend in auth.ts.
 */
export const authConfig = {
  providers: [Google],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    verifyRequest: "/login?sent=1",
  },
  callbacks: {
    authorized({ auth, request }) {
      if (!auth?.user) return false;
      // The InstaMedia workspace surface is hidden, not deleted (owner
      // decision 2026-09-20): its routes send people back to the hub, whose
      // workspace links lead into Platina. Remove this branch to restore it.
      const { pathname } = request.nextUrl;
      if (pathname === "/w" || pathname.startsWith("/w/")) {
        return Response.redirect(new URL("/hub", request.nextUrl));
      }
      return true;
    },
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
} satisfies NextAuthConfig;
