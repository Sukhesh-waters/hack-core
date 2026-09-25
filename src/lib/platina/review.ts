/**
 * What / why / how for one creative (C6 L4). Pure; the one model call that
 * drafts a review lives in learning-service.ts (no agent spawns an agent).
 *
 *  - WHAT happened is computed here: engagement rate against the client's own
 *    usual post (median of its other creatives), min-N gated. The model never
 *    writes a number; below the gate there is no index and no suggested
 *    verdict.
 *  - WHY / HOW / KEEP are drafted by the model from those facts, the
 *    creative's own stated hypothesis and the evidence its plan phase cited.
 *  - Nothing is learned until a person confirms the review. Confirming a
 *    "failed" review demotes the public insights the phase rested on
 *    (backtracking) — the reviewer sees the list and can untick any.
 */
import { z } from "zod";
import {
  REVIEW_FACTORS,
  REVIEW_VERDICTS,
  type PlanEvidenceSnapshot,
  type ReviewFacts,
  type ReviewVerdict,
  type ReviewWhy,
} from "@/db/platina-schema";
import { chunkRecord } from "./chunking";
import { extractJson } from "./json";

export type MetricSnapshot = {
  capturedAt: Date;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  engagements: number | null;
  saves: number | null;
  shares: number | null;
  videoViews: number | null;
  leads: number | null;
  spend: number | null;
};

export type ReviewCreative = {
  id: string;
  title: string;
  channel: string;
  format: string;
  topic: string | null;
  hookType: string | null;
  hypothesis: string;
  postedAt: Date | null;
  createdAt: Date;
};

/** Index at or above this = worked; at or below WORSE = failed; between = mixed. */
export const WORKED_INDEX = 1.1;
export const FAILED_INDEX = 0.9;

const DAY_MS = 86_400_000;

export function latestSnapshot(snapshots: MetricSnapshot[]): MetricSnapshot | null {
  return snapshots.reduce<MetricSnapshot | null>(
    (best, s) => (!best || s.capturedAt > best.capturedAt ? s : best),
    null,
  );
}

/**
 * Engagements per impression (reach when impressions are missing). Null when
 * either side is missing: a missing number is never read as 0.
 */
export function engagementRate(s: MetricSnapshot | null): number | null {
  if (!s || s.engagements === null) return null;
  const base = s.impressions ?? s.reach;
  if (base === null || base <= 0) return null;
  return s.engagements / base;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeReviewFacts(input: {
  creative: ReviewCreative;
  snapshots: MetricSnapshot[];
  /** Latest engagement rates of the client's OTHER creatives (null = not measurable). */
  peerRates: (number | null)[];
  minN: number;
  now: Date;
}): ReviewFacts {
  const last = latestSnapshot(input.snapshots);
  const rate = engagementRate(last);
  const peers = input.peerRates.filter((r): r is number => r !== null);
  const typical = peers.length >= input.minN ? median(peers) : null;
  const index = rate !== null && typical !== null && typical > 0 ? rate / typical : null;
  const since = input.creative.postedAt ?? input.creative.createdAt;
  return {
    snapshots: input.snapshots.length,
    days: Math.max(0, Math.floor((input.now.getTime() - since.getTime()) / DAY_MS)),
    impressions: last?.impressions ?? last?.reach ?? null,
    engagementRate: rate,
    medianEngagementRate: typical,
    index,
    baselineN: peers.length,
    leads: last?.leads ?? null,
    beatMedian: index === null ? null : index >= 1,
  };
}

/** The verdict the numbers point to. Null below the min-N gate: a person decides. */
export function suggestVerdict(facts: ReviewFacts): ReviewVerdict | null {
  if (facts.index === null) return null;
  // Rounded so a boundary value (22/1000 vs 2% = 1.0999...) lands where a person would put it.
  const index = Math.round(facts.index * 1000) / 1000;
  if (index >= WORKED_INDEX) return "worked";
  if (index <= FAILED_INDEX) return "failed";
  return "mixed";
}

/** A review opens once a creative has numbers and has run long enough. */
export function reviewDue(input: {
  creative: ReviewCreative;
  snapshots: MetricSnapshot[];
  reviewAfterDays: number;
  hasReview: boolean;
  now: Date;
}): boolean {
  if (input.hasReview || input.snapshots.length === 0) return false;
  const since = input.creative.postedAt ?? input.creative.createdAt;
  return input.now.getTime() - since.getTime() >= input.reviewAfterDays * DAY_MS;
}

/** "3.2%" / "1.24x" for facts shown to people and to the model. */
export const pct = (v: number | null) => (v === null ? "not measured" : `${(v * 100).toFixed(2)}%`);
export const times = (v: number | null) => (v === null ? "not enough other posts to compare" : `${v.toFixed(2)}x`);

export function describeFacts(facts: ReviewFacts, minN: number): string[] {
  const lines = [
    `${facts.snapshots} measurement${facts.snapshots === 1 ? "" : "s"} over ${facts.days} day${facts.days === 1 ? "" : "s"}`,
    `impressions: ${facts.impressions ?? "not measured"}`,
    `engagement rate: ${pct(facts.engagementRate)}`,
  ];
  if (facts.index !== null) {
    lines.push(`usual post: ${pct(facts.medianEngagementRate)} (median of ${facts.baselineN}); this one ${times(facts.index)}`);
  } else {
    lines.push(`usual post: not enough other measured posts (${facts.baselineN} of ${minN} needed), so no comparison`);
  }
  if (facts.leads !== null) lines.push(`leads: ${facts.leads}`);
  return lines;
}

// ---------------------------------------------------------------------------
// Model draft
// ---------------------------------------------------------------------------

const DraftSchema = z.object({
  verdict: z.enum(REVIEW_VERDICTS).nullable().optional(),
  what: z.string().min(1).max(600),
  why: z
    .array(
      z.object({
        factor: z.enum(REVIEW_FACTORS),
        effect: z.enum(["helped", "hurt", "neutral"]),
        reason: z.string().min(1).max(300),
      }),
    )
    .max(6),
  how: z.string().min(1).max(600),
  keep: z.string().max(400).optional().default(""),
});
export type ReviewDraft = z.infer<typeof DraftSchema>;

export function buildReviewPrompt(input: {
  clientName: string;
  creative: ReviewCreative;
  facts: ReviewFacts;
  minN: number;
  evidence: PlanEvidenceSnapshot[];
}): string {
  const c = input.creative;
  return [
    `You review one piece of marketing that ${input.clientName} published, so the team learns from it.`,
    `Piece: "${c.title}" — channel ${c.channel}, format ${c.format}${c.topic ? `, topic ${c.topic}` : ""}${c.hookType ? `, hook ${c.hookType}` : ""}${c.postedAt ? `, posted ${c.postedAt.toUTCString().slice(0, 16)}` : ""}.`,
    `What the team expected and why: ${c.hypothesis}`,
    `Measured facts (computed by code; these are the only numbers that exist):\n- ${describeFacts(input.facts, input.minN).join("\n- ")}`,
    input.evidence.length > 0
      ? `The plan phase this piece belonged to rested on:\n${input.evidence.map((e) => `- [${e.plane === "A" ? "own data" : "public signal"}] ${e.content.replace(/\s+/g, " ").slice(0, 240)}`).join("\n")}`
      : "The piece was not tied to any cited evidence.",
    "Answer four questions. WHAT happened, in one or two sentences, using only the facts above. WHY: for up to four factors (topic, hook, format, timing, audience, channel) say whether it helped, hurt or was neutral and why — a hypothesis, so say 'likely' where it is a guess. HOW: the one change to make next time. KEEP: what to repeat.",
    "Rules: never state a number that is not in the facts; never invent reach, clicks or benchmarks; if the facts cannot tell whether it worked, say so and set verdict null.",
    'Reply with JSON only: {"verdict":"worked"|"mixed"|"failed"|null,"what":string,"why":[{"factor":string,"effect":"helped"|"hurt"|"neutral","reason":string}],"how":string,"keep":string}',
  ].join("\n\n");
}

export function parseReviewDraft(raw: string): ReviewDraft | null {
  const parsed = DraftSchema.safeParse(extractJson(raw));
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Backtracking and the lesson
// ---------------------------------------------------------------------------

/** Confidence added to a public insight each time a confirmed win rested on it. */
export const PROMOTE_STEP = 0.05;
export const PROMOTE_CAP = 0.95;

export type BacktrackPlan = {
  /** Public (Plane C/B-derived Brain) insights to demote: the failed phase rested on them. */
  demote: string[];
  /** Public insights a confirmed win rested on: confidence up a step (capped). */
  promote: string[];
};

/**
 * Traces a confirmed result back to the evidence its plan phase cited. Only
 * public-signal evidence (Brain insights) moves: first-party evidence is the
 * client's own facts, not a hypothesis to demote. Mixed moves nothing.
 * `keep` is the reviewer's ticks: an unticked insight is left alone.
 */
export function planBacktrack(input: {
  verdict: ReviewVerdict;
  evidence: PlanEvidenceSnapshot[];
  keep?: Set<string>;
}): BacktrackPlan {
  const publicIds = input.evidence.filter((e) => e.plane === "B").map((e) => e.id);
  const chosen = input.keep ? publicIds.filter((id) => input.keep!.has(id)) : publicIds;
  if (input.verdict === "failed") return { demote: chosen, promote: [] };
  if (input.verdict === "worked") return { demote: [], promote: chosen };
  return { demote: [], promote: [] };
}

export function promotedConfidence(current: number): number {
  return Math.min(PROMOTE_CAP, current + PROMOTE_STEP);
}

/** The confirmed review as first-party text the planner can cite (Plane A). */
export function lessonText(input: {
  creative: ReviewCreative;
  verdict: ReviewVerdict;
  facts: ReviewFacts;
  what: string;
  why: ReviewWhy[];
  how: string;
  keep: string | null;
}): string {
  const c = input.creative;
  return chunkRecord({
    label: `Result of "${c.title}" (${input.verdict})`,
    fields: {
      channel: c.channel,
      format: c.format,
      topic: c.topic,
      hook: c.hookType,
      expected: c.hypothesis,
      measured: input.facts.index !== null ? `${times(input.facts.index)} the usual post's engagement rate` : null,
      what: input.what,
      why: input.why.map((w) => `${w.factor} ${w.effect}: ${w.reason}`).join("; ") || null,
      next_time: input.how,
      keep: input.keep,
    },
  });
}
