/**
 * Runs once per server start (Next.js instrumentation hook — requires
 * experimental.instrumentationHook in next.config.mjs on Next 14).
 *
 * Fails the boot loudly when required production env vars are missing,
 * instead of letting the app start and silently serve wrong config (e.g.
 * EMAIL_FROM falling back to "onboarding@resend.dev"). See src/lib/env.ts.
 */
export async function register() {
  // Only the Node.js server runtime needs env validated; the edge runtime
  // instrumentation entry point would otherwise re-run this in a context
  // where some of these vars are intentionally unavailable.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertEnv } = await import("@/lib/env");
    assertEnv();
  }
}
