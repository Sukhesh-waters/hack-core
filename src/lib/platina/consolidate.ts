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
};

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

export type Merge = { keepId: string; keep: string; absorbIds: string[]; absorbed: string[]; priorAbsorbed: string[]; similarity: number };
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
  return {
    month: input.month,
    lines,
    gained,
    lost,
    worked,
    failed,
    merged: input.plan.merges.reduce((n, m) => n + m.absorbIds.length, 0),
    retired: input.plan.retire.length,
  };
}
