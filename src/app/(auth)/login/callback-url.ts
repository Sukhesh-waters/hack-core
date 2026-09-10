/**
 * Only ever redirect somewhere inside this app. A callbackUrl is
 * user-controlled (it round-trips through the URL) and NextAuth's own
 * unauthenticated-redirect passes it as an absolute URL (e.g.
 * "http://localhost:3000/w/.../production"), not a bare path — so this
 * parses it and keeps only the path + query, discarding whatever host came
 * with it. That's what makes it safe: an attacker-supplied
 * "https://evil.com/x" collapses to the harmless path "/x", it never
 * becomes a redirect to evil.com.
 *
 * Plain module, not part of actions.ts: a "use server" file may only export
 * async functions, and this one is a pure sync helper.
 */
export function safeCallbackUrl(raw: string | null | undefined): string {
  if (!raw) return "/hub";
  try {
    const url = new URL(raw, "http://internal.invalid");
    return url.pathname + url.search || "/hub";
  } catch {
    return "/hub";
  }
}
