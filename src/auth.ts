import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { db } from "@/db";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
} from "@/db/schema";
import { authConfig } from "@/auth.config";

// The one and only identity this bypass will ever sign in as. Exact-match
// only — never a pattern/domain check — so nothing but this literal string
// can ever authenticate through it.
export const DEV_BYPASS_EMAIL = "dev@localhost.test";

const providers: NextAuthConfig["providers"] = [
  Google,
  Resend({
    from: process.env.EMAIL_FROM ?? "InstaMedia AI <login@example.com>",
  }),
];

// Dev-only sign-in bypass — never touches production auth.
//
// The Credentials provider is constructed and pushed into `providers`
// ONLY when BOTH gates hold at module-evaluation time:
//   - NODE_ENV is not "production"
//   - AUTH_DEV_BYPASS is the literal string "true" (explicit opt-in)
// If either is false, this block never runs, so the provider object is
// never created and `providers` never contains it — it is genuinely
// absent from the array, not merely present-but-rejecting at request time.
if (
  process.env.NODE_ENV !== "production" &&
  process.env.AUTH_DEV_BYPASS === "true"
) {
  providers.push(
    Credentials({
      id: "dev-bypass",
      name: "Dev bypass (non-production only)",
      credentials: {
        email: { label: "Email", type: "email" },
      },
      async authorize(credentials) {
        // Strict equality against the single hardcoded dev identity —
        // never a pattern/domain check, and never trust submitted input
        // beyond this one comparison.
        if (credentials?.email !== DEV_BYPASS_EMAIL) {
          return null;
        }

        // Credentials sign-in bypasses the adapter (by design — see
        // next-auth's own docs on the Credentials provider), so unlike
        // Google/Resend there's no adapter-driven row creation. Upsert by
        // email — safe to call repeatedly — so this dev identity has a
        // real `users` row for downstream membership/workspace lookups to
        // key off of, same as any other provider's user.
        const [devUser] = await db
          .insert(users)
          .values({ email: DEV_BYPASS_EMAIL, name: "Dev Bypass User" })
          .onConflictDoUpdate({
            target: users.email,
            set: { name: "Dev Bypass User" },
          })
          .returning();

        return {
          id: devUser.id,
          email: devUser.email,
          name: devUser.name,
        };
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers,
});

/** Session guard for server components and actions. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthenticated");
  }
  return { ...session.user, id: session.user.id };
}
