/**
 * The learning loop's side effects (C6 L4-L6): open and draft reviews,
 * confirm them (lesson + backtracking), and read the current learning state.
 * The decisions live in the pure modules (review.ts, learning.ts); this file
 * only loads, calls and writes.
 */
import type { PlanEvidenceSnapshot, ReviewVerdict, ReviewWhy } from "@/db/platina-schema";
import { demoteBrainChunk, getBrand, getPlan } from "@/db/queries/platina";
import {
  getCreative,
  getReviewForCreative,
  insertFirstPartyChunks,
  insertLearningEvents,
  listCreatives,
  listMetricsForCreatives,
  listReviews,
  setFirstPartyEmbedding,
  unembeddedFirstPartyChunksQuery,
  markReviewConfirmed,
  promoteBrainChunk,
  supersedeFirstPartyChunks,
  upsertReviewDraft,
} from "@/db/queries/platina-learning";
import { routeAI } from "@/lib/ai/router";
import { EMBED_BATCH, embedText, embedTexts } from "./embed";
import { learningConfig } from "./learning-read";
import { broadcastPlatinaSignal } from "./realtime-server";
import {
  buildReviewPrompt,
  computeReviewFacts,
  engagementRate,
  latestSnapshot,
  lessonText,
  parseReviewDraft,
  planBacktrack,
  PROMOTE_CAP,
  PROMOTE_STEP,
  reviewDue,
  suggestVerdict,
  type MetricSnapshot,
} from "./review";
import { DEMOTED_CONFIDENCE_FLOOR } from "./writeback";

export {
  creativeFeatures,
  learnedResults,
  learningConfig,
  learningState,
  statsForTopic,
  type LearningConfig,
  type LearningState,
} from "./learning-read";

type CreativeRow = Awaited<ReturnType<typeof listCreatives>>[number];
type MetricRow = Awaited<ReturnType<typeof listMetricsForCreatives>>[number];

function toSnapshot(m: MetricRow): MetricSnapshot {
  return {
    capturedAt: m.capturedAt,
    impressions: m.impressions,
    reach: m.reach,
    clicks: m.clicks,
    engagements: m.engagements,
    saves: m.saves,
    shares: m.shares,
    videoViews: m.videoViews,
    leads: m.leads,
    spend: m.spend,
  };
}

/** The evidence the creative's plan phase cited (empty when not tied to a plan). */
export async function phaseEvidence(
  workspaceId: string,
  creative: { planId: string | null; phaseId: string | null },
): Promise<PlanEvidenceSnapshot[]> {
  if (!creative.planId) return [];
  const plan = await getPlan(workspaceId, creative.planId);
  if (!plan) return [];
  const doc = plan.plan;
  const phase = creative.phaseId ? doc.phases.find((p) => p.id === creative.phaseId) : null;
  const ids = new Set(phase ? phase.evidenceIds ?? [] : doc.phases.flatMap((p) => p.evidenceIds ?? []));
  return (doc.evidence ?? []).filter((e) => ids.has(e.id));
}

/** Latest engagement rates of the client's creatives, by creative id. */
function latestRates(creatives: CreativeRow[], metrics: MetricRow[]): Map<string, number | null> {
  const byCreative = new Map<string, MetricSnapshot[]>();
  for (const m of metrics) {
    const list = byCreative.get(m.creativeId) ?? [];
    list.push(toSnapshot(m));
    byCreative.set(m.creativeId, list);
  }
  return new Map(creatives.map((c) => [c.id, engagementRate(latestSnapshot(byCreative.get(c.id) ?? []))]));
}

/**
 * Computes the facts and asks the model for a what/why/how draft. A model
 * failure still stores the facts (a person can write the review), with the
 * reason, never a made-up draft.
 */
export async function draftReview(workspaceId: string, creativeId: string): Promise<"drafted" | "facts_only" | "skipped"> {
  const creative = await getCreative(workspaceId, creativeId);
  if (!creative) return "skipped";
  const existing = await getReviewForCreative(workspaceId, creativeId);
  if (existing?.status === "confirmed") return "skipped";

  const config = await learningConfig(workspaceId);
  const peers = (await listCreatives(workspaceId, creative.brandId)).filter((c) => c.id !== creative.id);
  const metrics = await listMetricsForCreatives(workspaceId, [creative.id, ...peers.map((p) => p.id)]);
  const own = metrics.filter((m) => m.creativeId === creative.id).map(toSnapshot);
  const rates = latestRates(peers, metrics);
  const facts = computeReviewFacts({
    creative,
    snapshots: own,
    peerRates: peers.map((p) => rates.get(p.id) ?? null),
    minN: config.minN,
    now: new Date(),
  });

  const brand = creative.brandId ? await getBrand(workspaceId, creative.brandId) : null;
  const evidence = await phaseEvidence(workspaceId, creative);
  let draft = null;
  let draftError: string | null = null;
  try {
    const result = await routeAI({
      kind: "chat",
      tier: "fast",
      json: true,
      prompt: buildReviewPrompt({ clientName: brand?.name ?? "the client", creative, facts, minN: config.minN, evidence }),
    });
    draft = parseReviewDraft(result);
    if (!draft) draftError = "The model's answer could not be read; write the review by hand.";
  } catch (error) {
    draftError = `No model was available (${error instanceof Error ? error.message.slice(0, 160) : "unknown"}); write the review by hand.`;
  }

  await upsertReviewDraft(workspaceId, creativeId, {
    facts,
    // The numbers' verdict wins over the model's; the model's only fills a gap.
    verdict: suggestVerdict(facts) ?? draft?.verdict ?? null,
    what: draft?.what ?? null,
    why: draft?.why ?? [],
    how: draft?.how ?? null,
    keep: draft?.keep || null,
    draftedBy: "model",
    draftError,
  });
  await broadcastPlatinaSignal(workspaceId, "results", creativeId);
  return draft ? "drafted" : "facts_only";
}

/** Opens a draft review for every creative that is due (numbers + waiting time, no review yet). */
export async function openDueReviews(workspaceId: string, brandId?: string | null): Promise<number> {
  const config = await learningConfig(workspaceId);
  const creatives = await listCreatives(workspaceId, brandId);
  if (creatives.length === 0) return 0;
  const ids = creatives.map((c) => c.id);
  const [metrics, reviews] = await Promise.all([listMetricsForCreatives(workspaceId, ids), listReviews(workspaceId, ids)]);
  const reviewed = new Set(reviews.map((r) => r.creativeId));
  const now = new Date();
  let opened = 0;
  for (const c of creatives) {
    const snapshots = metrics.filter((m) => m.creativeId === c.id).map(toSnapshot);
    if (!reviewDue({ creative: c, snapshots, reviewAfterDays: config.reviewAfterDays, hasReview: reviewed.has(c.id), now })) {
      continue;
    }
    await draftReview(workspaceId, c.id);
    opened += 1;
  }
  return opened;
}

export type ConfirmInput = {
  reviewId: string;
  creativeId: string;
  verdict: ReviewVerdict;
  what: string;
  why: ReviewWhy[];
  how: string;
  keep: string | null;
  /** Public insights the reviewer left ticked for backtracking. */
  backtrackIds: string[];
  edited: boolean;
  userId: string;
};

export type ConfirmResult = { confirmed: boolean; demoted: number; promoted: number; lesson: boolean };

/**
 * Confirms a review: the one step that makes the system learn.
 *  1. The review is marked confirmed (once; a double submit does nothing).
 *  2. A lesson is written as first-party knowledge (Plane A), so plans cite it.
 *  3. Backtracking: the public insights the plan phase rested on are demoted
 *     (failed) or strengthened (worked), limited to the reviewer's ticks.
 *  4. Every change is logged with its cause.
 */
export async function confirmReview(workspaceId: string, input: ConfirmInput): Promise<ConfirmResult> {
  const creative = await getCreative(workspaceId, input.creativeId);
  const review = await getReviewForCreative(workspaceId, input.creativeId);
  if (!creative || !review || review.id !== input.reviewId) {
    return { confirmed: false, demoted: 0, promoted: 0, lesson: false };
  }
  const ok = await markReviewConfirmed(workspaceId, review.id, {
    verdict: input.verdict,
    what: input.what,
    why: input.why,
    how: input.how,
    keep: input.keep,
    draftedBy: input.edited ? "human" : (review.draftedBy as "model" | "human"),
    confirmedById: input.userId,
  });
  if (!ok) return { confirmed: false, demoted: 0, promoted: 0, lesson: false };

  // Lesson (Plane A). An embedding outage stores it unembedded: it is still
  // on the record, and the daily learning job embeds it (backfillEmbeddings).
  const text = lessonText({
    creative,
    verdict: input.verdict,
    facts: review.facts,
    what: input.what,
    why: input.why,
    how: input.how,
    keep: input.keep,
  });
  const embedding = await embedText(text);
  await supersedeFirstPartyChunks(workspaceId, [review.id]);
  const [lessonId] = await insertFirstPartyChunks([
    {
      workspaceId,
      brandId: creative.brandId,
      kind: "lesson",
      sourceRef: review.id,
      sourceUrl: creative.url,
      title: creative.title,
      content: text,
      chunkIndex: 0,
      ...(embedding ? { embedding } : {}),
    },
  ]);

  const evidence = await phaseEvidence(workspaceId, creative);
  const plan = planBacktrack({ verdict: input.verdict, evidence, keep: new Set(input.backtrackIds) });
  for (const id of plan.demote) await demoteBrainChunk(workspaceId, id, undefined, DEMOTED_CONFIDENCE_FLOOR);
  for (const id of plan.promote) await promoteBrainChunk(workspaceId, id, PROMOTE_STEP, PROMOTE_CAP);

  const evidenceText = new Map(evidence.map((e) => [e.id, e.content.slice(0, 200)]));
  await insertLearningEvents([
    {
      workspaceId,
      brandId: creative.brandId,
      kind: "lesson",
      reviewId: review.id,
      targetRef: lessonId ?? null,
      detail: { creative: creative.title, verdict: input.verdict, embedded: Boolean(embedding) },
    },
    ...plan.demote.map((id) => ({
      workspaceId,
      brandId: creative.brandId,
      kind: "demote" as const,
      reviewId: review.id,
      targetRef: id,
      detail: { creative: creative.title, insight: evidenceText.get(id) ?? null, reason: "a confirmed failed result rested on it" },
    })),
    ...plan.promote.map((id) => ({
      workspaceId,
      brandId: creative.brandId,
      kind: "promote" as const,
      reviewId: review.id,
      targetRef: id,
      detail: { creative: creative.title, insight: evidenceText.get(id) ?? null, reason: "a confirmed win rested on it" },
    })),
  ]);
  await broadcastPlatinaSignal(workspaceId, "results", review.id);
  if (plan.demote.length + plan.promote.length > 0) await broadcastPlatinaSignal(workspaceId, "insights");
  return { confirmed: true, demoted: plan.demote.length, promoted: plan.promote.length, lesson: true };
}

/**
 * Embeds first-party passages stored during an embedding outage (own-site
 * pages, lessons), in batched requests, up to `limit` per run. Stops at the
 * first failure: the provider is still limiting, tomorrow continues.
 */
export async function backfillEmbeddings(workspaceId: string, limit = 400): Promise<number> {
  const rows = await unembeddedFirstPartyChunksQuery(workspaceId, limit);
  let done = 0;
  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const batch = rows.slice(i, i + EMBED_BATCH);
    const vectors = await embedTexts(batch.map((r) => r.content));
    if (!vectors) break;
    for (const [j, row] of batch.entries()) await setFirstPartyEmbedding(workspaceId, row.id, vectors[j]);
    done += batch.length;
  }
  return done;
}
