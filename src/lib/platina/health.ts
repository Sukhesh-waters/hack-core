/**
 * Collection-loop health (core spine S0). Pure shaping only — no IO, no JSX.
 * Each evaluator turns already-gathered facts into a HealthCheck the page can
 * render; `health-collect.ts` does the gathering. Splitting them keeps every
 * status rule unit-testable without a database, a provider, or a clock.
 *
 * Why this exists: a stopped Inngest dev server makes the whole loop go quiet
 * with no error anywhere. Every check here names the exact next action.
 */

export type ProbeStatus = "ok" | "degraded" | "down" | "not_configured";

export type HealthCheck = {
  id: string;
  label: string;
  status: ProbeStatus;
  /** A human sentence. Never contains a secret. */
  detail: string;
  /** The exact next action, when status is not ok. */
  remedy?: string;
  /** Collection cannot work while a required check is down/unconfigured. */
  required: boolean;
};

const RANK: Record<ProbeStatus, number> = {
  ok: 0,
  not_configured: 1,
  degraded: 2,
  down: 3,
};

export function summarize(checks: HealthCheck[]): {
  status: ProbeStatus;
  blocking: HealthCheck[];
} {
  const status = checks.reduce<ProbeStatus>(
    (worst, c) => (RANK[c.status] > RANK[worst] ? c.status : worst),
    "ok",
  );
  const blocking = checks.filter(
    (c) =>
      c.required && (c.status === "down" || c.status === "not_configured"),
  );
  return { status, blocking };
}

// ---------------------------------------------------------------------------
// Secret hygiene
// ---------------------------------------------------------------------------

/**
 * Scrubs anything credential-shaped from text bound for the page: `key=`
 * query params, bearer tokens, and any literal secret value passed in.
 * Values shorter than 8 characters are not treated as secrets (they would
 * shred ordinary words).
 */
export function redact(text: string, secrets: Array<string | undefined> = []): string {
  let out = text
    .replace(/key=[^&\s"']+/gi, "key=[redacted]")
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join("[redacted]");
  }
  return out.slice(0, 300);
}

// ---------------------------------------------------------------------------
// Evaluators
// ---------------------------------------------------------------------------

/** Presence only — the value is never rendered, logged or length-reported. */
export function checkApifyToken(present: boolean): HealthCheck {
  return present
    ? {
        id: "apify_token",
        label: "Collection provider (Apify)",
        status: "ok",
        detail: "An Apify token is configured.",
        required: true,
      }
    : {
        id: "apify_token",
        label: "Collection provider (Apify)",
        status: "not_configured",
        detail: "No Apify token is set, so no source can be fetched.",
        remedy: "Set APIFY_TOKEN in .env.local (or the Vercel project) and restart.",
        required: true,
      };
}

export type TierProbe =
  | { ok: true; provider: string; model: string; latencyMs?: number }
  | { ok: false; message: string; status?: number };

export function checkModelTier(input: {
  tier: "fast" | "quality";
  /** The provider the ladder should answer from when everything is healthy. */
  expectedProvider: string;
  probe: TierProbe;
}): HealthCheck {
  const { tier, expectedProvider, probe } = input;
  const base = {
    id: `model_router_${tier}`,
    label: `AI router — ${tier} tier`,
    required: true,
  };
  if (!probe.ok) {
    const retired = probe.status === 404;
    return {
      ...base,
      status: "down",
      detail: `No provider answered: ${probe.message}`,
      remedy: retired
        ? "A model id looks retired (404). Update the constant in src/lib/ai/router.ts and note the old id in its comment."
        : "Check GROQ_API_KEY / GEMINI_API_KEY and provider status, then re-run the check.",
    };
  }
  const took = probe.latencyMs === undefined ? "" : ` in ${probe.latencyMs}ms`;
  if (probe.provider !== expectedProvider) {
    return {
      ...base,
      status: "degraded",
      detail: `Answered by ${probe.provider} (${probe.model})${took}, not the expected ${expectedProvider} — the ladder fell back.`,
      remedy: `Find why ${expectedProvider} failed: look for a failed row in the AI usage log for this tier.`,
    };
  }
  return {
    ...base,
    status: "ok",
    detail: `Answered by ${probe.provider} (${probe.model})${took}.`,
  };
}

export type SpecActivity = {
  cadenceMinutes: number;
  probeCapable: boolean;
  lastProbeAt: Date | null;
  lastRunAt: Date | null;
};

/** Slack over the cadence before a silent probe counts as a missing heartbeat. */
const HEARTBEAT_SLACK = 3;
const HEARTBEAT_FLOOR_MINUTES = 15;
/** Probe-less sources back off to 24h; silence shorter than that is normal. */
const PROBELESS_SILENCE_MINUTES = 24 * 60 + 30;

const minutesSince = (then: Date, now: Date) =>
  Math.floor((now.getTime() - then.getTime()) / 60_000);

/**
 * Is the scheduler ticking? Uses spec-level activity rather than audit runs:
 * an unchanged (304) probe records `lastProbeAt` but correctly creates no run,
 * so run recency alone would cry wolf for a healthy quiet source.
 */
export function checkScheduler(input: {
  now: Date;
  specs: SpecActivity[];
  latestRunEventAt: Date | null;
  devMode: boolean;
  /** Result of probing the Inngest dev server (dev mode only). */
  devServer?: "up" | "down" | "not_dev";
}): HealthCheck {
  const base = {
    id: "inngest",
    label: "Background jobs (Inngest)",
    required: true,
  };
  const startRemedy = input.devMode
    ? "Start the job runner in a second terminal: npm run dev:jobs (with npm run dev running)."
    : "Confirm the app is synced in the Inngest dashboard and INNGEST_SIGNING_KEY / INNGEST_EVENT_KEY are set.";

  // Definite, not inferred: in dev, a first pass is queued the moment sources
  // are approved and only the dev server can run it.
  if (input.devServer === "down") {
    return {
      ...base,
      status: "down",
      detail:
        "The Inngest dev server is not running, so no collection, analysis or profile can run — and nothing will log an error.",
      remedy:
        "Run npm run dev:all (starts the app and the job runner together), or npm run dev:jobs in a second terminal.",
    };
  }

  if (input.specs.length === 0) {
    return {
      ...base,
      status: "ok",
      detail: "No approved sources yet, so nothing is expected to run.",
    };
  }

  const stamps = input.specs.flatMap((s) => [s.lastProbeAt, s.lastRunAt]);
  if (input.latestRunEventAt) stamps.push(input.latestRunEventAt);
  const latest = stamps.reduce<Date | null>(
    (best, d) => (d && (!best || d > best) ? d : best),
    null,
  );

  const probed = input.specs.filter((s) => s.probeCapable);
  const threshold =
    probed.length > 0
      ? Math.max(
          HEARTBEAT_FLOOR_MINUTES,
          HEARTBEAT_SLACK * Math.min(...probed.map((s) => s.cadenceMinutes)),
        )
      : PROBELESS_SILENCE_MINUTES;

  if (!latest) {
    return {
      ...base,
      status: "degraded",
      detail: `${input.specs.length} approved source(s) but the scheduler has never touched one.`,
      remedy: startRemedy,
    };
  }
  const age = minutesSince(latest, input.now);
  if (age > threshold) {
    return {
      ...base,
      status: "degraded",
      detail: `Last scheduler activity was ${age} minutes ago (expected within ${threshold}).`,
      remedy: startRemedy,
    };
  }
  return {
    ...base,
    status: "ok",
    detail: `Last scheduler activity ${age} minute(s) ago.`,
  };
}

const DB_SLOW_MS = 1000;

export function checkDatabase(
  input: { ms: number } | { error: string },
): HealthCheck {
  const base = { id: "database", label: "Database", required: true };
  if ("error" in input) {
    return {
      ...base,
      status: "down",
      detail: `Query failed: ${input.error}`,
      remedy: "Check DATABASE_URL and that the Supabase pooler (port 6543) is reachable.",
    };
  }
  if (input.ms >= DB_SLOW_MS) {
    return {
      ...base,
      status: "degraded",
      detail: `Round trip took ${input.ms}ms (slow above ${DB_SLOW_MS}ms).`,
      remedy: "Check network path to the pooler; a cold connection is normal once.",
    };
  }
  return { ...base, status: "ok", detail: `Round trip ${input.ms}ms.` };
}

export type CollectionStats = {
  approvedSpecs: number;
  docsToday: number;
  findingsToday: number;
  actorCallsToday: number;
  /** Workspace daily page limit; null only when unknown. */
  actorCallCap: number | null;
};

export function checkCollection(stats: CollectionStats): HealthCheck {
  const base = { id: "collection", label: "Collection today", required: false };
  const summary =
    `${stats.approvedSpecs} approved source(s) · ${stats.docsToday} new document(s) · ` +
    `${stats.findingsToday} finding(s) · ${stats.actorCallsToday}` +
    (stats.actorCallCap === null ? "" : `/${stats.actorCallCap}`) +
    ` page(s) read`;
  if (stats.approvedSpecs === 0) {
    return {
      ...base,
      status: "not_configured",
      detail: "No approved sources — nothing is being collected.",
      remedy: "Approve at least one source under Audits.",
    };
  }
  if (stats.actorCallCap !== null && stats.actorCallsToday >= stats.actorCallCap) {
    return {
      ...base,
      status: "degraded",
      detail: `Paused: daily collection cap reached. ${summary}.`,
      remedy: "Collection resumes at 00:00 UTC. Raising the cap is an owner decision.",
    };
  }
  return { ...base, status: "ok", detail: `${summary}.` };
}
