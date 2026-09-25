/**
 * The learning engine's server side (C8.5): reads the suggestion ledger and
 * the public lane, and applies the monthly consolidation. Server-only: DB.
 */
import { listBrands, listInterestSignals } from "@/db/queries/platina";
import {
  consolidatableBrainQuery,
  insertLearningSnapshot,
  learningSnapshotsQuery,
  mergeBrainChunks,
  setBrainChunksStatus,
  suggestionEventsQuery,
  suggestionsQuery,
  type SuggestionRow,
} from "@/db/queries/platina-learning";
import { buildDigest, planConsolidation, weightsOf, type ConsolidationPlan, type Digest } from "./consolidate";
import { learnFromLedger, type LedgerEvent, type Learned } from "./credit";
import type { FeatureStat } from "./learning";
import { learningConfig, type LearningConfig } from "./learning-read";
import { describePublicStat, publicLaneStats } from "./learning-public";

/** The public lane reads the client's own posts from this far back. */
const PUBLIC_LANE_DAYS = 365;

export type LearningView = {
  client: { id: string; name: string } | null;
  config: LearningConfig;
  suggestions: SuggestionRow[];
  events: LedgerEvent[];
  learned: Learned;
  publicStats: FeatureStat[];
};

export async function loadLearning(workspaceId: string, now: Date = new Date()): Promise<LearningView> {
  const [brands, config, suggestions, eventRows] = await Promise.all([
    listBrands(workspaceId),
    learningConfig(workspaceId),
    suggestionsQuery(workspaceId, { limit: 2000 }),
    suggestionEventsQuery(workspaceId),
  ]);
  const client = brands.find((b) => b.kind === "own_brand" && b.status === "active") ?? null;
  const events: LedgerEvent[] = eventRows.map((e) => ({
    id: e.id,
    suggestionId: e.suggestionId,
    kind: e.kind,
    reason: e.reason,
    reward: e.reward,
    detail: e.detail,
    createdAt: new Date(e.createdAt),
  }));
  const learned = learnFromLedger(
    suggestions.map((s) => ({ id: s.id, title: s.title, inputs: s.inputs, features: s.features })),
    events,
    { now, halfLifeDays: config.halfLifeDays, minN: config.minN },
  );
  const publicStats = client
    ? publicLaneStats(
        await listInterestSignals(workspaceId, [client.id], new Date(now.getTime() - PUBLIC_LANE_DAYS * 86_400_000)),
        client.id,
        { now, halfLifeDays: config.halfLifeDays, minN: config.minN },
      )
    : [];
  return { client: client ? { id: client.id, name: client.name } : null, config, suggestions, events, learned, publicStats };
}

/**
 * Learned patterns for the idea engine: what has worked, past min-N, best
 * first. Public-lane lines say "(public data)"; ledger lines say what people
 * decided. Never a pattern below the gate.
 */
export function learnedPatterns(view: LearningView, max = 6): { text: string; ref: string }[] {
  const name = view.client?.name ?? "the client";
  const fromPublic = view.publicStats
    .filter((s) => s.status === "ok" && s.low > 0.5)
    .sort((a, b) => b.mean - a.mean)
    .map((s) => ({ text: describePublicStat(s, name, view.config.minN), ref: `pattern:public:${s.feature}:${s.value}`, mean: s.mean }));
  const fromLedger = view.learned.features
    .filter((s) => s.status === "ok" && s.mean > 0.6)
    .sort((a, b) => b.mean - a.mean)
    .map((s) => ({
      text: `Suggestions with ${s.feature} "${s.value}" were taken up: ${Math.round(s.mean * 100)}% over ${s.n} decisions and results`,
      ref: `pattern:ledger:${s.feature}:${s.value}`,
      mean: s.mean,
    }));
  return [...fromPublic, ...fromLedger].sort((a, b) => b.mean - a.mean).slice(0, max).map(({ text, ref }) => ({ text, ref }));
}

export type ConsolidationResult = { month: string; plan: ConsolidationPlan; digest: Digest; applied: boolean; alreadyDone: boolean };

/** Dry run (apply=false) or the real thing. Idempotent per month. */
export async function runConsolidation(workspaceId: string, opts: { apply: boolean; now?: Date }): Promise<ConsolidationResult> {
  const now = opts.now ?? new Date();
  const month = now.toISOString().slice(0, 7);
  const [view, brain, snapshots] = await Promise.all([
    loadLearning(workspaceId, now),
    consolidatableBrainQuery(workspaceId),
    learningSnapshotsQuery(workspaceId),
  ]);
  const alreadyDone = snapshots.some((s) => s.month === month);
  const plan = planConsolidation({
    brain: brain.map((b) => ({ ...b, createdAt: new Date(b.createdAt), lastRetrievedAt: b.lastRetrievedAt ? new Date(b.lastRetrievedAt) : null })),
    trust: view.learned.trust,
    now,
  });
  const weights = weightsOf(view.learned, view.publicStats);
  const previous = snapshots.find((s) => s.month < month)?.weights as ReturnType<typeof weightsOf> | undefined;
  const digest = buildDigest({
    month,
    weights,
    previous: previous ?? null,
    learned: view.learned,
    titles: new Map(view.suggestions.map((s) => [s.id, s.title])),
    plan,
    halfLifeDays: view.config.halfLifeDays,
  });
  if (!opts.apply || alreadyDone) return { month, plan, digest, applied: false, alreadyDone };
  // Claim the month first: a second run (the cron and a person at once) finds
  // the snapshot and changes nothing.
  const claimed = await insertLearningSnapshot({
    workspaceId,
    month,
    weights: weights as unknown as Record<string, unknown>,
    digest: {
      ...digest,
      mergeList: plan.merges.map((m) => ({ keep: m.keep, absorbed: m.absorbed })),
      retireList: plan.retire,
    } as unknown as Record<string, unknown>,
  });
  if (!claimed) return { month, plan, digest, applied: false, alreadyDone: true };
  for (const m of plan.merges) await mergeBrainChunks(workspaceId, m.keepId, m.absorbIds, m.priorAbsorbed);
  await setBrainChunksStatus(workspaceId, plan.retire.map((r) => r.id), "archived");
  return { month, plan, digest, applied: true, alreadyDone: false };
}
