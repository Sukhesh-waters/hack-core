/**
 * Monthly consolidation (C8.5 T85.6). Pure: what the job WOULD change, so the
 * Learning page can show a dry run and the job applies exactly that.
 *
 *  - Merge: near-duplicate Brain insights (debate and idea insights; measured
 *    ones replace themselves already) fold into the strongest one. The others
 *    are superseded — kept, never deleted — and listed on the survivor.
 *  - Retire: insights past the window, unused lately, and low in trust are
 *    archived (restorable). With no trust evidence nothing is retired: age
 *    alone is not a reason.
 *  - Decay: every count fades with the half-life when it is read, so there is
 *    nothing to rewrite; the digest says so.
 *  - Snapshot + digest: this month's weights, and what changed since the last
 *    snapshot, as numbers code computed and sentences code wrote.
 *
 * Idempotent per month: the snapshot is unique per (workspace, month), and a
 * merged or archived insight is no longer a candidate.
 */
import type { FeatureStat } from "./learning";
import type { LaneStat, Learned, TrustStat } from "./credit";

/**
 * Word overlap (Jaccard) at which two insights say the same thing. Long
 * sentences dilute overlap: live 2026-09-24 on Waters, every pair at 0.30+
 * (8 of 11k) was the same news told twice (a board retirement, one webinar
 * three times), and nothing distinct scored that high.
 */
export const MERGE_SIMILARITY = 0.3;
/** Retire only insights older than this... */
export const RETIRE_AGE_DAYS = 120;
/** ...not retrieved for this long... */
export const RETIRE_UNUSED_DAYS = 60;
/** ...and trusted less than this (with enough evidence to say so). */
export const RETIRE_TRUST = 0.4;

export type BrainRow = {
  id: string;
  content: string;
  confidence: number;
  status: string;
  absorbedChunkIds: string[];
  lastRetrievedAt: Date | null;
  createdAt: Date;
  /** B9: preserved on the survivor when near-duplicate insights merge. */
  falsifier?: unknown;
  generation?: number;
};

/**
 * B9 Goodhart check: Spearman rank correlation (with average ranks for ties)
 * between the proxy (engagement index / review verdict) and the outcome
 * (`qualified_leads` when supplied, else `leads`). Below `minN`, or when
 * either series has zero variance, returns `insufficient` — never a
 * synthesised number. Flags when rho < 0.3.
 */
export const PROXY_OUTCOME_RHO_FLOOR = 0.3;

export type ProxyOutcomeCorrelation =
  | { status: "ok"; rho: number; n: number; flagged: boolean }
  | { status: "insufficient"; n: number };

function averageRanks(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j += 1;
    const avgRank = (i + j + 2) / 2;
    for (let k = i; k <= j; k += 1) ranks[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

export function spearmanCorrelation(
  pairs: { proxy: number | null | undefined; outcome: number | null | undefined }[],
  minN = 5,
): ProxyOutcomeCorrelation {
  const valid = pairs.filter(
    (p): p is { proxy: number; outcome: number } =>
      typeof p.proxy === "number" &&
      Number.isFinite(p.proxy) &&
      typeof p.outcome === "number" &&
      Number.isFinite(p.outcome),
  );
  if (valid.length < minN) {
    return { status: "insufficient", n: valid.length };
  }
  const rx = averageRanks(valid.map((p) => p.proxy));
  const ry = averageRanks(valid.map((p) => p.outcome));
  const n = valid.length;
  const meanX = (n + 1) / 2;
  const meanY = (n + 1) / 2;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = rx[i] - meanX;
    const dy = ry[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) {
    return { status: "insufficient", n };
  }
  const rho = Math.round((cov / Math.sqrt(varX * varY)) * 1000) / 1000;
  return {
    status: "ok",
    rho,
    n,
    flagged: rho < PROXY_OUTCOME_RHO_FLOOR,
  };
}

/**
 * B9 consolidation ceiling: maximum generation used as sole support must stay
 * strictly below 2 (`canCiteHypothesisAlone`).
 */
export function maxSoleHypothesisGeneration(generations: number[]): {
  maxGeneration: number | null;
  ok: boolean;
} {
  if (generations.length === 0) return { maxGeneration: null, ok: true };
  const maxGen = Math.max(...generations);
  return { maxGeneration: maxGen, ok: maxGen < 2 };
}

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "their", "they", "are", "was", "were", "has", "have", "its", "into", "than", "more", "about", "over", "which", "while", "been", "also", "will", "can", "not", "but", "our", "your"]);

export function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      // Typographic hyphens ("Antibody‑Conjugated") make the same word.
      .replace(/[‐-―]/g, "-")
      .replace(/[^a-z0-9\s-]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP.has(w)),
  );
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export type Merge = {
  keepId: string;
  keep: string;
  absorbIds: string[];
  absorbed: string[];
  priorAbsorbed: string[];
  similarity: number;
  /** B9: the survivor's falsifier is kept intact across consolidation merges. */
  keepFalsifier?: unknown;
};
export type Retire = { id: string; content: string; why: string };

export type ConsolidationPlan = { merges: Merge[]; retire: Retire[] };

export function planConsolidation(input: { brain: BrainRow[]; trust: TrustStat[]; now: Date }): ConsolidationPlan {
  const active = input.brain.filter((b) => b.status === "active");
  // Strongest first: it survives and absorbs the ones like it.
  const ordered = [...active].sort(
    (a, b) => b.confidence - a.confidence || b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const bag = new Map(ordered.map((b) => [b.id, words(b.content)]));
  const taken = new Set<string>();
  const merges: Merge[] = [];
  for (const keep of ordered) {
    if (taken.has(keep.id)) continue;
    const absorbed: { row: BrainRow; sim: number }[] = [];
    for (const other of ordered) {
      if (other.id === keep.id || taken.has(other.id)) continue;
      const sim = similarity(bag.get(keep.id)!, bag.get(other.id)!);
      if (sim >= MERGE_SIMILARITY) absorbed.push({ row: other, sim });
    }
    if (absorbed.length === 0) continue;
    taken.add(keep.id);
    for (const a of absorbed) taken.add(a.row.id);
    merges.push({
      keepId: keep.id,
      keep: keep.content,
      absorbIds: absorbed.map((a) => a.row.id),
      absorbed: absorbed.map((a) => a.row.content),
      priorAbsorbed: keep.absorbedChunkIds,
      similarity: Math.round(Math.min(...absorbed.map((a) => a.sim)) * 100) / 100,
      ...(keep.falsifier !== undefined ? { keepFalsifier: keep.falsifier } : {}),
    });
  }

  const trustByRef = new Map(input.trust.map((t) => [t.ref, t]));
  const retire: Retire[] = [];
  for (const b of active) {
    if (taken.has(b.id)) continue;
    const ageDays = (input.now.getTime() - b.createdAt.getTime()) / 86_400_000;
    const unusedDays = b.lastRetrievedAt ? (input.now.getTime() - b.lastRetrievedAt.getTime()) / 86_400_000 : ageDays;
    const t = trustByRef.get(`brain:${b.id}`);
    if (ageDays < RETIRE_AGE_DAYS || unusedDays < RETIRE_UNUSED_DAYS || !t || t.status !== "ok" || t.mean >= RETIRE_TRUST) continue;
    retire.push({
      id: b.id,
      content: b.content,
      why: `${Math.round(ageDays)} days old, not used for ${Math.round(unusedDays)} days, trust ${Math.round(t.mean * 100)}% over ${t.n} decisions`,
    });
  }
  return { merges, retire };
}

export type Digest = {
  month: string;
  lines: string[];
  gained: { what: string; from: number; to: number }[];
  lost: { what: string; from: number; to: number }[];
  worked: string[];
  failed: string[];
  merged: number;
  retired: number;
  proxyVsOutcome?: ProxyOutcomeCorrelation;
  maxSoleSupportGeneration?: number | null;
};

type Weights = { features: Record<string, number>; publicLane: Record<string, number>; trust: Record<string, number> };

/** The weights saved with a month's snapshot (only values past min-N). */
export function weightsOf(learned: Learned, publicStats: FeatureStat[]): Weights {
  const lane = (s: LaneStat) => `${s.feature}:${s.value}`;
  return {
    features: Object.fromEntries(learned.features.filter((s) => s.status === "ok").map((s) => [lane(s), s.mean])),
    publicLane: Object.fromEntries(publicStats.filter((s) => s.status === "ok").map((s) => [`${s.feature}:${s.value}`, Math.round(s.mean * 1000) / 1000])),
    trust: Object.fromEntries(learned.trust.filter((t) => t.status === "ok").map((t) => [t.ref, t.mean])),
  };
}

/** What changed this month, in numbers and plain sentences (no model call). */
export function buildDigest(input: {
  month: string;
  weights: Weights;
  previous: Weights | null;
  learned: Learned;
  titles: Map<string, string>;
  plan: ConsolidationPlan;
  halfLifeDays: number;
  proxyVsOutcomePairs?: { proxy: number | null | undefined; outcome: number | null | undefined }[];
  minN?: number;
  soleSupportGenerations?: number[];
}): Digest {
  const before = input.previous;
  const moves: { what: string; from: number; to: number }[] = [];
  for (const [group, label] of [
    ["features", "suggestions with"],
    ["publicLane", "own posts on"],
  ] as const) {
    for (const [key, to] of Object.entries(input.weights[group])) {
      const from = before?.[group]?.[key] ?? 0.5;
      if (Math.abs(to - from) >= 0.05) moves.push({ what: `${label} ${key.replace(/^[a-z]+:/, "")}`, from, to });
    }
  }
  const gained = moves.filter((m) => m.to > m.from).sort((a, b) => b.to - b.from - (a.to - a.from));
  const lost = moves.filter((m) => m.to < m.from).sort((a, b) => a.to - a.from - (b.to - b.from));
  const results = input.learned.credits.filter((c) => c.weight === 1 && c.features.length > 0);
  const worked = [...new Set(results.filter((c) => c.reward >= 0.5).map((c) => input.titles.get(c.suggestionId) ?? c.suggestionId))];
  const failed = [...new Set(results.filter((c) => c.reward < 0.5).map((c) => input.titles.get(c.suggestionId) ?? c.suggestionId))];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const lines = [
    gained.length
      ? `Gained weight: ${gained.slice(0, 5).map((g) => `${g.what} (${pct(g.from)} → ${pct(g.to)})`).join("; ")}.`
      : "No pattern gained weight past the evidence threshold.",
    lost.length ? `Lost weight: ${lost.slice(0, 5).map((g) => `${g.what} (${pct(g.from)} → ${pct(g.to)})`).join("; ")}.` : "No pattern lost weight.",
    worked.length || failed.length
      ? `Results came back for ${worked.length + failed.length} suggestions: ${worked.length} worked, ${failed.length} did not.`
      : "No measured result came back for a suggestion yet; decisions (planned, dismissed) are counted at a fraction of a result.",
    `Brain: ${input.plan.merges.reduce((n, m) => n + m.absorbIds.length, 0)} repeated insights folded into the ${input.plan.merges.length} they repeat (kept, not deleted); ${input.plan.retire.length} retired.`,
    `All counts fade with a ${input.halfLifeDays}-day half-life, so older evidence weighs less each month.`,
  ];
  let proxyVsOutcome: ProxyOutcomeCorrelation | undefined;
  if (input.proxyVsOutcomePairs) {
    proxyVsOutcome = spearmanCorrelation(input.proxyVsOutcomePairs, input.minN ?? 5);
    if (proxyVsOutcome.status === "ok") {
      lines.push(
        proxyVsOutcome.flagged
          ? `Warning: engagement proxy and leads diverged (Spearman ρ = ${proxyVsOutcome.rho} over ${proxyVsOutcome.n} items, below ${PROXY_OUTCOME_RHO_FLOOR}).`
          : `Engagement proxy tracks leads (Spearman ρ = ${proxyVsOutcome.rho} over ${proxyVsOutcome.n} items).`,
      );
    } else {
      lines.push(`Engagement vs leads correlation: not enough data yet (${proxyVsOutcome.n} of ${input.minN ?? 5} needed).`);
    }
  }
  let maxSoleSupportGeneration: number | null | undefined;
  if (input.soleSupportGenerations) {
    maxSoleSupportGeneration = maxSoleHypothesisGeneration(input.soleSupportGenerations).maxGeneration;
  }
  return {
    month: input.month,
    lines,
    gained,
    lost,
    worked,
    failed,
    merged: input.plan.merges.reduce((n, m) => n + m.absorbIds.length, 0),
    retired: input.plan.retire.length,
    ...(proxyVsOutcome ? { proxyVsOutcome } : {}),
    ...(maxSoleSupportGeneration !== undefined ? { maxSoleSupportGeneration } : {}),
  };
}
