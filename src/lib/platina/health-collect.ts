/**
 * Gathers the facts behind each health check (IO lives here; the status rules
 * live in health.ts). Two entry points so the page never pays for a paid AI
 * call unless the operator asks: `collectCoreHealth` is free, and
 * `probeModelRouter` sends one ~1-token prompt per tier.
 */
import {
  countDocsSince,
  countFindingsSince,
  getLatestRunEventAt,
  getWorkspaceConfig,
  getWorkspacePagesToday,
  listScanSpecs,
  pingDatabase,
} from "@/db/queries/platina";
import {
  AIRouterError,
  ladderHead,
  routeChatWithProvenance,
} from "@/lib/ai/router";
import {
  checkApifyToken,
  checkCollection,
  checkDatabase,
  checkModelTier,
  checkScheduler,
  redact,
  type HealthCheck,
  type SpecActivity,
  type TierProbe,
} from "./health";
import { isProbeCapable } from "./fetch/schedule";
import { probeInngestDev } from "./inngest-dev";

const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const startOfUtcDay = (d: Date) => new Date(`${utcDay(d)}T00:00:00.000Z`);

const secrets = () => [
  process.env.APIFY_TOKEN,
  process.env.GROQ_API_KEY,
  process.env.GEMINI_API_KEY,
  process.env.DATABASE_URL,
];

const errorText = (error: unknown) =>
  redact(error instanceof Error ? error.message : String(error), secrets());

async function timed<T>(run: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = Date.now();
  const value = await run();
  return { value, ms: Date.now() - start };
}

/** Free checks: token presence, database, scheduler heartbeat, today's counters. */
export async function collectCoreHealth(
  workspaceId: string,
  now: Date = new Date(),
): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [
    checkApifyToken(Boolean(process.env.APIFY_TOKEN)),
  ];

  let database: HealthCheck;
  try {
    database = checkDatabase({ ms: (await timed(pingDatabase)).ms });
  } catch (error) {
    database = checkDatabase({ error: errorText(error) });
  }
  checks.push(database);
  // Without a database nothing below can be measured; say so, don't guess.
  if (database.status === "down") return checks;

  const since = startOfUtcDay(now);
  const [specs, latestRunEventAt, docsToday, findingsToday, config, pagesToday] =
    await Promise.all([
      listScanSpecs(workspaceId),
      getLatestRunEventAt(workspaceId),
      countDocsSince(workspaceId, since),
      countFindingsSince(workspaceId, since),
      getWorkspaceConfig(workspaceId),
      getWorkspacePagesToday(workspaceId, utcDay(now)),
    ]);
  const live = specs.filter((s) => s.status === "approved" && s.enabled);

  const activity: SpecActivity[] = live.map((s) => ({
    cadenceMinutes: s.cadenceMinutes,
    probeCapable: isProbeCapable(s.targets[0]?.kind ?? "competitor_site"),
    lastProbeAt: s.lastProbeAt,
    lastRunAt: s.lastRunAt,
  }));

  checks.push(
    checkScheduler({
      now,
      specs: activity,
      latestRunEventAt,
      devMode: Boolean(process.env.INNGEST_DEV),
      devServer: await probeInngestDev(),
    }),
    checkCollection({
      approvedSpecs: live.length,
      docsToday,
      findingsToday,
      actorCallsToday: pagesToday,
      actorCallCap: config?.dailyActorCallCap ?? 40,
    }),
  );
  return checks;
}

async function probeTier(tier: "fast" | "quality"): Promise<TierProbe> {
  try {
    const reply = await routeChatWithProvenance({
      kind: "chat",
      tier,
      prompt: "Reply with the single word: ok",
    });
    return {
      ok: true,
      provider: reply.provider,
      model: reply.model,
      latencyMs: reply.latencyMs,
    };
  } catch (error) {
    return {
      ok: false,
      message: errorText(error),
      status: error instanceof AIRouterError ? error.status : undefined,
    };
  }
}

/** Paid: one ~1-token call per tier. Only runs when the operator asks. */
export async function probeModelRouter(): Promise<HealthCheck[]> {
  const tiers = ["fast", "quality"] as const;
  const probes = await Promise.all(tiers.map(probeTier));
  return tiers.map((tier, i) =>
    checkModelTier({
      tier,
      expectedProvider: ladderHead(tier),
      probe: probes[i],
    }),
  );
}
