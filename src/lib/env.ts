import { z } from "zod";

/**
 * Production env guard (constitution: degradation ladder — fail loud, never
 * silently serve wrong config).
 *
 * Scope: only vars whose ABSENCE in production causes a silent wrong-config
 * failure rather than a loud one. Examples deliberately left OUT:
 *  - AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY: the Bedrock
 *    quality tier is self-gating via bedrockConfigured() (src/lib/flags.ts)
 *    and the router ladder falls back to Gemini/Groq. Absence is a
 *    supported, silent-by-design degradation, not a misconfiguration.
 *  - GEMINI_API_KEY: only a fallback inside routeAI's own ladder (Groq is
 *    the primary fast-tier provider). Missing it degrades gracefully to a
 *    thrown AIRouterError on the rare path that needs it, not a wrong
 *    value being served.
 *  - META_CONNECTOR_ENABLED: a feature flag, false by default on purpose.
 *  - GEMINI_QUALITY_MODEL / BEDROCK_MODEL_ID / AI_DAILY_COST_CAP_USD /
 *    APIFY_ACTOR_*: optional overrides with safe, correct defaults in code.
 *  - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: only
 *    used by the hub realtime feature; absence disables that feature
 *    (checked at call site), it does not serve wrong data.
 *  - SUPABASE_SERVICE_ROLE_KEY: server-only key for the workspace-assets
 *    bucket. Absence disables file upload/download visibly (see
 *    storageConfigured() in src/lib/storage.ts); it never serves wrong
 *    data, so it follows the same rule as the NEXT_PUBLIC_SUPABASE_* pair.
 *
 * Included below: every var that is read unconditionally in a
 * request/boot path in production and whose absence today causes either a
 * thrown-at-call-time error deep in a request (DATABASE_URL, AUTH_SECRET,
 * GROQ_API_KEY, APIFY_TOKEN) or — worse — a silently wrong fallback value
 * that looks like it's working (EMAIL_FROM falling back to
 * "onboarding@resend.dev", see reports/actions.ts, reminders.ts,
 * ai/budget.ts, auth.ts).
 */

const requiredInProduction = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "GROQ_API_KEY",
  "APIFY_TOKEN",
] as const;

export type RequiredEnvVar = (typeof requiredInProduction)[number];

/**
 * zod schema over the vars this app requires in production. Every field is
 * a non-empty string — empty string counts as "missing" (a common footgun
 * with platform env UIs that leave a var declared-but-blank).
 */
export const envSchema = z.object(
  Object.fromEntries(
    requiredInProduction.map((name) => [
      name,
      z.string().min(1, `${name} is required in production`),
    ]),
  ) as Record<RequiredEnvVar, z.ZodString>,
);

export type CheckEnvResult =
  | { ok: true; warnings: string[] }
  | { ok: false; missing: string[] };

/**
 * Pure, testable. In non-production, missing vars never fail the check —
 * they're surfaced as warnings so local/dev/test setups keep working
 * without a full .env.local. In production, any missing (or empty-string)
 * required var fails the check and is named in `missing`.
 */
export function checkEnv(
  env: Record<string, string | undefined>,
  nodeEnv: string,
): CheckEnvResult {
  const missing = requiredInProduction.filter((name) => !env[name]?.length);

  if (nodeEnv === "production") {
    if (missing.length > 0) {
      return { ok: false, missing };
    }
    return { ok: true, warnings: [] };
  }

  return { ok: true, warnings: missing };
}

/**
 * Boot-time guard. Call once at server start. Throws a single error naming
 * every missing var when running in production; otherwise logs a warning
 * and lets the process continue (dev/test should never require a full
 * production env to run).
 */
export function assertEnv(): void {
  const result = checkEnv(process.env, process.env.NODE_ENV ?? "development");

  if (!result.ok) {
    throw new Error(
      `Missing required production environment variables: ${result.missing.join(", ")}. ` +
        "Refusing to boot with incomplete config (see src/lib/env.ts).",
    );
  }

  if (result.warnings.length > 0) {
    console.warn(
      `[env] Missing optional environment variables (fine outside production): ${result.warnings.join(", ")}`,
    );
  }
}
