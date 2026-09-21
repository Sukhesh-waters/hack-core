import { aiUsage } from "@/db/schema";
import { and, cosineDistance, count, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, max, notInArray, or, sql } from "drizzle-orm";
import { STALE_CLAIM_MINUTES } from "@/lib/platina/analysis";
import { db } from "@/db";
import {
  platinaAlertRules,
  platinaAuditRunEvents,
  platinaAuditRuns,
  platinaBrandChunks,
  platinaBrands,
  platinaBrainChunks,
  platinaBrandSources,
  platinaCampaigns,
  platinaClaimsRules,
  platinaDebateTranscripts,
  platinaEventParticipants,
  platinaEvents,
  platinaFindings,
  platinaGateEvents,
  platinaInterestSignals,
  platinaAlertDeliveries,
  platinaOutcomeImports,
  platinaOutcomes,
  platinaPlanFeedback,
  platinaPlans,
  platinaReceipts,
  platinaScanSpecs,
  platinaSignalDocuments,
  platinaSolutionTasks,
  platinaWorkspaceConfig,
  platinaWorkspaceProfiles,
  PLATINA_EMBEDDING_MODEL_VERSION,
  type PlanDoc,
  type PlanOrigin,
  type PlanVerdict,
  type ClientProfile,
  type PlatinaBrandHandles,
  type PlatinaFindingEvidence,
  type PlatinaRunConfigSnapshot,
  type PlatinaScanTarget,
} from "@/db/platina-schema";
import type { GateWrite } from "@/lib/platina/gates";
import type { RawSignalDoc } from "@/lib/platina/fetch/registry";
import type { FindingStatus } from "@/lib/platina/findings";
import type { RunStatus } from "@/lib/platina/run-status";

export function similarBrandChunksQuery(
  workspaceId: string,
  embedding: number[],
  limit = 8,
) {
  const distance = cosineDistance(platinaBrandChunks.embedding, embedding);
  return db
    .select({
      id: platinaBrandChunks.id,
      content: platinaBrandChunks.content,
      sourceUrl: platinaBrandChunks.sourceUrl,
      score: sql<number>`(1 - (${distance}))`,
    })
    .from(platinaBrandChunks)
    .where(
      and(
        eq(platinaBrandChunks.workspaceId, workspaceId),
        isNull(platinaBrandChunks.supersededAt),
        // R4.1: only the active embedding generation is retrievable. A model
        // change requires an explicit backfill, never silent coexistence.
        eq(
          platinaBrandChunks.embeddingModelVersion,
          PLATINA_EMBEDDING_MODEL_VERSION,
        ),
      ),
    )
    .orderBy(distance)
    .limit(limit);
}

export function similarBrainChunksQuery(
  workspaceId: string,
  embedding: number[],
  limit = 6,
) {
  const distance = cosineDistance(platinaBrainChunks.embedding, embedding);
  return db
    .select({
      id: platinaBrainChunks.id,
      content: platinaBrainChunks.content,
      confidence: platinaBrainChunks.confidence,
      generation: platinaBrainChunks.generation,
      score: sql<number>`(1 - (${distance}))`,
    })
    .from(platinaBrainChunks)
    .where(
      and(
        eq(platinaBrainChunks.workspaceId, workspaceId),
        eq(platinaBrainChunks.status, "active"),
        eq(
          platinaBrainChunks.embeddingModelVersion,
          PLATINA_EMBEDDING_MODEL_VERSION,
        ),
      ),
    )
    .orderBy(distance)
    .limit(limit);
}

export function brandChunksQuery(workspaceId: string) {
  return db
    .select()
    .from(platinaBrandChunks)
    .where(
      and(
        eq(platinaBrandChunks.workspaceId, workspaceId),
        isNull(platinaBrandChunks.supersededAt),
      ),
    )
    .orderBy(desc(platinaBrandChunks.createdAt));
}

export function signalDocumentsQuery(workspaceId: string) {
  return db
    .select()
    .from(platinaSignalDocuments)
    .where(eq(platinaSignalDocuments.workspaceId, workspaceId))
    .orderBy(desc(platinaSignalDocuments.createdAt));
}

export function brainChunksQuery(workspaceId: string) {
  return db
    .select()
    .from(platinaBrainChunks)
    .where(
      and(
        eq(platinaBrainChunks.workspaceId, workspaceId),
        eq(platinaBrainChunks.status, "active"),
      ),
    )
    .orderBy(desc(platinaBrainChunks.createdAt));
}

export function gateEventsQuery(workspaceId: string) {
  return db
    .select()
    .from(platinaGateEvents)
    .where(eq(platinaGateEvents.workspaceId, workspaceId))
    .orderBy(desc(platinaGateEvents.createdAt));
}

export function scanSpecsQuery(workspaceId: string) {
  return db
    .select()
    .from(platinaScanSpecs)
    .where(eq(platinaScanSpecs.workspaceId, workspaceId))
    .orderBy(desc(platinaScanSpecs.createdAt));
}

export function receiptsQuery(workspaceId: string) {
  return db
    .select()
    .from(platinaReceipts)
    .where(eq(platinaReceipts.workspaceId, workspaceId))
    .orderBy(desc(platinaReceipts.createdAt));
}

export function dueReceiptsQuery(workspaceId: string, now: Date) {
  return db
    .select()
    .from(platinaReceipts)
    .where(
      and(
        eq(platinaReceipts.workspaceId, workspaceId),
        eq(platinaReceipts.outcome, "pending"),
        lte(platinaReceipts.reviewAt, now),
      ),
    );
}

export function campaignsQuery(workspaceId: string) {
  return db
    .select()
    .from(platinaCampaigns)
    .where(eq(platinaCampaigns.workspaceId, workspaceId))
    .orderBy(desc(platinaCampaigns.createdAt));
}

export function outcomesQuery(workspaceId: string) {
  return db
    .select()
    .from(platinaOutcomes)
    .where(eq(platinaOutcomes.workspaceId, workspaceId))
    .orderBy(desc(platinaOutcomes.recordedAt));
}

export function alertRulesQuery(workspaceId: string) {
  return db
    .select()
    .from(platinaAlertRules)
    .where(
      and(
        eq(platinaAlertRules.workspaceId, workspaceId),
        eq(platinaAlertRules.enabled, true),
      ),
    );
}

/** All rules including disabled — the Admin management view. */
export function allAlertRulesQuery(workspaceId: string) {
  return db
    .select()
    .from(platinaAlertRules)
    .where(eq(platinaAlertRules.workspaceId, workspaceId))
    .orderBy(desc(platinaAlertRules.createdAt));
}

export async function listBrandChunks(workspaceId: string) {
  return brandChunksQuery(workspaceId);
}

export async function listBrainChunks(workspaceId: string) {
  return brainChunksQuery(workspaceId);
}

export async function listScanSpecs(workspaceId: string) {
  return scanSpecsQuery(workspaceId);
}

export async function listReceipts(workspaceId: string) {
  return receiptsQuery(workspaceId);
}

export async function listCampaigns(workspaceId: string) {
  return campaignsQuery(workspaceId);
}

export async function listGateEvents(workspaceId: string) {
  return gateEventsQuery(workspaceId);
}

export async function listOutcomes(workspaceId: string) {
  return outcomesQuery(workspaceId);
}

export async function getWorkspaceConfig(workspaceId: string) {
  const rows = await db
    .select()
    .from(platinaWorkspaceConfig)
    .where(eq(platinaWorkspaceConfig.workspaceId, workspaceId))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertGateEvent(event: GateWrite) {
  const [row] = await db
    .insert(platinaGateEvents)
    .values({
      workspaceId: event.workspaceId,
      gate: event.gate,
      decision: event.decision,
      approverId: event.approverId,
      payloadHash: event.payloadHash,
      subjectType: event.subjectType,
      subjectId: event.subjectId,
      reason: event.reason,
    })
    .returning({ id: platinaGateEvents.id });
  return row.id;
}

/**
 * Retires the current standard for one client so a re-confirmation replaces
 * it instead of stacking a second copy beside it (R3). Never deletes: the old
 * standard stays readable as history.
 */
/** How many live standard chunks this client has — 0 means "not confirmed". */
export function brandStandardChunkCountQuery(workspaceId: string, brandId: string) {
  return db
    .select({ value: count() })
    .from(platinaBrandChunks)
    .where(
      and(
        eq(platinaBrandChunks.workspaceId, workspaceId),
        eq(platinaBrandChunks.brandId, brandId),
        isNull(platinaBrandChunks.supersededAt),
      ),
    );
}

export async function countBrandStandardChunks(workspaceId: string, brandId: string) {
  const [row] = await brandStandardChunkCountQuery(workspaceId, brandId);
  return Number(row?.value ?? 0);
}

/**
 * Charges pages against a client's one-time first-pass allowance (R7).
 * Additive in SQL so two concurrent runs cannot lose each other's spend.
 */
export async function addFirstPassPages(
  workspaceId: string,
  brandId: string,
  pages: number,
) {
  if (pages <= 0) return;
  await db
    .update(platinaBrands)
    .set({
      firstPassPagesUsed: sql`${platinaBrands.firstPassPagesUsed} + ${pages}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(platinaBrands.workspaceId, workspaceId),
        eq(platinaBrands.id, brandId),
      ),
    );
}

/**
 * Remembers that a target only yields content to a rendered crawl (R9), so the
 * wasted plain pass happens once rather than on every tick. Rewrites the
 * targets array in place; unknown targets are left untouched.
 */
export async function markTargetsRendered(
  workspaceId: string,
  specId: string,
  targetValues: string[],
) {
  if (targetValues.length === 0) return;
  const spec = await getScanSpec(workspaceId, specId);
  if (!spec) return;
  const wanted = new Set(targetValues);
  const targets = spec.targets.map((target) =>
    wanted.has(target.value) && !target.renderJs
      ? { ...target, renderJs: true }
      : target,
  );
  if (targets.every((t, i) => t.renderJs === spec.targets[i].renderJs)) return;
  await db
    .update(platinaScanSpecs)
    .set({ targets, updatedAt: new Date() })
    .where(
      and(
        eq(platinaScanSpecs.workspaceId, workspaceId),
        eq(platinaScanSpecs.id, specId),
      ),
    );
}

/**
 * Replaces a spec's targets without touching updatedAt (which anchors a
 * never-run source's schedule). Workspace-scoped.
 */
export async function updateScanSpecTargets(
  workspaceId: string,
  specId: string,
  targets: PlatinaScanTarget[],
) {
  await db
    .update(platinaScanSpecs)
    .set({ targets })
    .where(and(eq(platinaScanSpecs.workspaceId, workspaceId), eq(platinaScanSpecs.id, specId)));
}

/** A one-time backfill is done once its target has collected: clear the flag. */
export async function clearTargetBackfill(workspaceId: string, specId: string, targetValues: string[]) {
  const spec = await getScanSpec(workspaceId, specId);
  if (!spec) return;
  const done = new Set(targetValues);
  if (!spec.targets.some((t) => t.backfill && done.has(t.value))) return;
  await updateScanSpecTargets(
    workspaceId,
    specId,
    spec.targets.map((t) => {
      if (!t.backfill || !done.has(t.value)) return t;
      const rest = { ...t };
      delete rest.backfill;
      return rest;
    }),
  );
}

/**
 * Remembers which pages the site picker chose for each target (C1), so the
 * next collection within a week reads the same pages without re-listing the
 * site. Workspace-scoped like every write; touches only the named targets.
 */
export async function rememberPickedPages(
  workspaceId: string,
  specId: string,
  picks: { target: string; urls: string[] }[],
  now: Date = new Date(),
) {
  if (picks.length === 0) return;
  const spec = await getScanSpec(workspaceId, specId);
  if (!spec) return;
  const byTarget = new Map(picks.map((p) => [p.target, p.urls]));
  const targets = spec.targets.map((target) => {
    const urls = byTarget.get(target.value);
    return urls ? { ...target, pickedPages: urls, pickedAt: now.toISOString() } : target;
  });
  await db
    .update(platinaScanSpecs)
    // updatedAt deliberately untouched: it anchors a never-run source's
    // schedule, and remembering picks is bookkeeping, not an approval.
    .set({ targets })
    .where(
      and(
        eq(platinaScanSpecs.workspaceId, workspaceId),
        eq(platinaScanSpecs.id, specId),
      ),
    );
}

export async function supersedeBrandChunksForBrand(
  workspaceId: string,
  brandId: string,
) {
  await db
    .update(platinaBrandChunks)
    .set({ supersededAt: new Date() })
    .where(
      and(
        eq(platinaBrandChunks.workspaceId, workspaceId),
        eq(platinaBrandChunks.brandId, brandId),
        isNull(platinaBrandChunks.supersededAt),
      ),
    );
}

export async function insertBrandChunk(input: {
  workspaceId: string;
  content: string;
  sourceUrl?: string;
  title?: string;
  embedding?: number[];
  chunkIndex?: number;
  /** The client this standard describes (R3). Null = workspace-wide. */
  brandId?: string | null;
}) {
  const [row] = await db
    .insert(platinaBrandChunks)
    .values(input)
    .returning({ id: platinaBrandChunks.id });
  return row.id;
}

/**
 * Dedupe is physical: the unique index on (scan_spec_id, content_hash)
 * refuses an unchanged re-fetch, so this returns the count of genuinely new
 * rows — not the count the actor returned.
 */
export async function insertSignalDocuments(
  workspaceId: string,
  scanSpecId: string,
  docs: RawSignalDoc[],
) {
  if (docs.length === 0) return 0;
  const inserted = await db
    .insert(platinaSignalDocuments)
    .values(
      docs.map((doc) => ({
        workspaceId,
        scanSpecId,
        sourceUrl: doc.sourceUrl,
        canonicalUrl: doc.canonicalUrl ?? null,
        sourceKind: doc.sourceKind ?? null,
        contentHash: doc.contentHash ?? null,
        title: doc.title,
        body: doc.body,
        adapter: doc.adapter,
        raw: doc.raw,
        metrics: doc.metrics ?? null,
      })),
    )
    .onConflictDoNothing({
      target: [
        platinaSignalDocuments.scanSpecId,
        platinaSignalDocuments.contentHash,
      ],
    })
    .returning({ id: platinaSignalDocuments.id });
  return inserted.length;
}

export async function insertBrainChunk(input: {
  workspaceId: string;
  content: string;
  confidence: number;
  agreementState: "agreed" | "qualified" | "contested" | "refuted";
  sourceSignalIds: string[];
  generation?: number;
  absorbedChunkIds?: string[];
  transcriptId?: string;
  embedding?: number[];
  /** Measured market insights only (C5): one active chunk per key. */
  insightKey?: string;
}) {
  const [row] = await db
    .insert(platinaBrainChunks)
    .values({
      workspaceId: input.workspaceId,
      content: input.content,
      confidence: input.confidence,
      agreementState: input.agreementState,
      sourceSignalIds: input.sourceSignalIds,
      generation: input.generation ?? 0,
      absorbedChunkIds: input.absorbedChunkIds ?? [],
      transcriptId: input.transcriptId,
      embedding: input.embedding,
      insightKey: input.insightKey ?? null,
    })
    .returning({ id: platinaBrainChunks.id });
  return row.id;
}

export async function insertTranscript(input: {
  workspaceId: string;
  signalIds: string[];
  proposerClaim: string;
  challengerAttack: string;
  score: number;
  state: "agreed" | "qualified" | "contested" | "refuted";
  strongestObjection?: string;
}) {
  const [row] = await db
    .insert(platinaDebateTranscripts)
    .values(input)
    .returning({ id: platinaDebateTranscripts.id });
  return row.id;
}

export async function insertScanSpec(input: {
  workspaceId: string;
  name: string;
  targets: PlatinaScanTarget[];
  createdById: string;
  cadenceMinutes?: number;
  brandId?: string | null;
}) {
  const [row] = await db
    .insert(platinaScanSpecs)
    .values(input)
    .returning({ id: platinaScanSpecs.id });
  return row.id;
}

export async function approveScanSpec(workspaceId: string, specId: string) {
  await db
    .update(platinaScanSpecs)
    .set({ status: "approved", updatedAt: new Date() })
    .where(
      and(
        eq(platinaScanSpecs.workspaceId, workspaceId),
        eq(platinaScanSpecs.id, specId),
      ),
    );
}

export async function getScanSpec(workspaceId: string, specId: string) {
  const rows = await db
    .select()
    .from(platinaScanSpecs)
    .where(
      and(
        eq(platinaScanSpecs.workspaceId, workspaceId),
        eq(platinaScanSpecs.id, specId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listApprovedScanSpecs() {
  return db
    .select()
    .from(platinaScanSpecs)
    .where(eq(platinaScanSpecs.status, "approved"));
}

export async function insertReceipt(input: {
  workspaceId: string;
  title: string;
  hypothesis: string;
  expectedOutcome: string;
  evidenceBrandIds: string[];
  evidenceBrainIds: string[];
  reviewAt: Date;
  ownerId: string;
  findingId?: string | null;
  severity?: string | null;
  urgency?: string | null;
  strongestUncertainty?: string | null;
  measurementMethod?: string | null;
}) {
  const [row] = await db
    .insert(platinaReceipts)
    .values(input)
    .returning({ id: platinaReceipts.id });
  return row.id;
}

export async function recordReceiptOutcome(input: {
  workspaceId: string;
  receiptId: string;
  outcome: "worked" | "did_not_work" | "inconclusive";
  outcomeNote?: string;
}) {
  const result = await db
    .update(platinaReceipts)
    .set({
      outcome: input.outcome,
      outcomeNote: input.outcomeNote,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(platinaReceipts.workspaceId, input.workspaceId),
        eq(platinaReceipts.id, input.receiptId),
        eq(platinaReceipts.outcome, "pending"),
      ),
    )
    .returning({ id: platinaReceipts.id });
  return result[0]?.id ?? null;
}

export async function insertCampaign(input: {
  workspaceId: string;
  title: string;
  receiptId?: string;
  durationDays?: number;
  geography?: string;
  budget?: number;
  channelMix?: string[];
  eventAnchor?: Date;
  eventLabel?: string;
  audience?: string;
  contentPlan?: string;
  useCase?: string;
}) {
  const [row] = await db
    .insert(platinaCampaigns)
    .values(input)
    .returning({ id: platinaCampaigns.id });
  return row.id;
}

/** Solutions index: campaigns joined to their decision receipts. */
export function solutionsQuery(workspaceId: string) {
  return db
    .select({
      campaign: platinaCampaigns,
      receipt: platinaReceipts,
    })
    .from(platinaCampaigns)
    .leftJoin(
      platinaReceipts,
      eq(platinaCampaigns.receiptId, platinaReceipts.id),
    )
    .where(eq(platinaCampaigns.workspaceId, workspaceId))
    .orderBy(desc(platinaCampaigns.createdAt));
}

/** Plan fields are editable only while a solution is a draft. */
export async function updateDraftCampaign(
  workspaceId: string,
  campaignId: string,
  patch: {
    durationDays?: number;
    geography?: string;
    channelMix?: string[];
    audience?: string;
    contentPlan?: string;
    eventLabel?: string;
    eventAnchor?: Date;
  },
) {
  const updated = await db
    .update(platinaCampaigns)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(platinaCampaigns.workspaceId, workspaceId),
        eq(platinaCampaigns.id, campaignId),
        eq(platinaCampaigns.status, "draft"),
      ),
    )
    .returning({ id: platinaCampaigns.id });
  return updated[0]?.id ?? null;
}

/** Rejection closes the draft; the gate event carries the decision. */
export async function closeDraftCampaign(
  workspaceId: string,
  campaignId: string,
) {
  const updated = await db
    .update(platinaCampaigns)
    .set({ status: "closed", updatedAt: new Date() })
    .where(
      and(
        eq(platinaCampaigns.workspaceId, workspaceId),
        eq(platinaCampaigns.id, campaignId),
        eq(platinaCampaigns.status, "draft"),
      ),
    )
    .returning({ id: platinaCampaigns.id });
  return updated[0]?.id ?? null;
}

export async function getCampaign(workspaceId: string, campaignId: string) {
  const rows = await db
    .select()
    .from(platinaCampaigns)
    .where(
      and(
        eq(platinaCampaigns.workspaceId, workspaceId),
        eq(platinaCampaigns.id, campaignId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Final approval moves the solution from draft to planned — a real state
 *  change, not just a recorded event. */
export async function markCampaignPlanned(
  workspaceId: string,
  campaignId: string,
) {
  const updated = await db
    .update(platinaCampaigns)
    .set({ status: "planned", updatedAt: new Date() })
    .where(
      and(
        eq(platinaCampaigns.workspaceId, workspaceId),
        eq(platinaCampaigns.id, campaignId),
        eq(platinaCampaigns.status, "draft"),
      ),
    )
    .returning({ id: platinaCampaigns.id });
  return updated[0]?.id ?? null;
}

export async function insertOutcome(input: {
  workspaceId: string;
  campaignId?: string;
  receiptId?: string;
  leads: number;
  qualifiedLeads: number;
  conversionRate?: number;
  pipelineContribution?: number;
  qualityScore?: number;
  recordedAt?: Date;
  source?: string;
}) {
  const [row] = await db
    .insert(platinaOutcomes)
    .values(input)
    .returning({ id: platinaOutcomes.id });
  return row.id;
}

export async function demoteBrainChunk(
  workspaceId: string,
  chunkId: string,
  demotedByReceiptId?: string,
  confidenceFloor?: number,
) {
  await db
    .update(platinaBrainChunks)
    .set({
      status: "demoted",
      ...(demotedByReceiptId ? { demotedByReceiptId } : {}),
      ...(confidenceFloor !== undefined
        ? { confidence: sql`LEAST(${platinaBrainChunks.confidence}, ${confidenceFloor})` }
        : {}),
    })
    .where(
      and(
        eq(platinaBrainChunks.workspaceId, workspaceId),
        eq(platinaBrainChunks.id, chunkId),
      ),
    );
}

export async function touchBrainRetrieved(workspaceId: string, chunkId: string) {
  await db
    .update(platinaBrainChunks)
    .set({ lastRetrievedAt: new Date() })
    .where(
      and(
        eq(platinaBrainChunks.workspaceId, workspaceId),
        eq(platinaBrainChunks.id, chunkId),
      ),
    );
}

export async function upsertWorkspaceConfig(
  workspaceId: string,
  patch: Partial<{
    minBaselineN: number;
    contestedFloor: number;
    qualifiedFloor: number;
    similarityFloor: number;
    dailyActorCallCap: number;
    analysisSequence: ("competitor_scan" | "brand_divergence" | "ideation" | "claims_screen")[];
    promptVersion: number;
  }>,
) {
  const existing = await getWorkspaceConfig(workspaceId);
  if (existing) {
    await db
      .update(platinaWorkspaceConfig)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(platinaWorkspaceConfig.workspaceId, workspaceId));
    return existing.id;
  }
  const [row] = await db
    .insert(platinaWorkspaceConfig)
    .values({ workspaceId, ...patch })
    .returning({ id: platinaWorkspaceConfig.id });
  return row.id;
}

/** Waiting for analysis: never started, or claimed by a worker that died. */
function analysisPending(staleBefore: Date) {
  return or(
    eq(platinaSignalDocuments.processingState, "unprocessed"),
    and(
      eq(platinaSignalDocuments.processingState, "processing"),
      or(
        isNull(platinaSignalDocuments.processingStartedAt),
        lte(platinaSignalDocuments.processingStartedAt, staleBefore),
      ),
    ),
  );
}

const staleClaimCutoff = () => new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000);

export function unprocessedSignalsQuery(
  workspaceId: string,
  limit = 20,
  staleBefore: Date = staleClaimCutoff(),
) {
  return db
    .select()
    .from(platinaSignalDocuments)
    .where(
      and(
        eq(platinaSignalDocuments.workspaceId, workspaceId),
        analysisPending(staleBefore),
      ),
    )
    // Newest first: a backlog must never hide the freshest signals.
    .orderBy(desc(platinaSignalDocuments.createdAt))
    .limit(limit);
}

export async function listUnresolvedSignals(workspaceId: string, limit = 20) {
  return unprocessedSignalsQuery(workspaceId, limit);
}

/**
 * The version of the same page that came before this one (core spine R1).
 * Scoped to the workspace and matched on the canonical URL, so a re-fetch of
 * the same page under a different scan spec still finds its predecessor.
 * Newest first — the one immediately before `before`.
 */
export function previousSignalDocumentQuery(
  workspaceId: string,
  canonicalUrl: string,
  before: Date,
) {
  return db
    .select({
      id: platinaSignalDocuments.id,
      title: platinaSignalDocuments.title,
      body: platinaSignalDocuments.body,
      fetchedAt: platinaSignalDocuments.fetchedAt,
    })
    .from(platinaSignalDocuments)
    .where(
      and(
        eq(platinaSignalDocuments.workspaceId, workspaceId),
        eq(platinaSignalDocuments.canonicalUrl, canonicalUrl),
        lt(platinaSignalDocuments.fetchedAt, before),
      ),
    )
    .orderBy(desc(platinaSignalDocuments.fetchedAt))
    .limit(1);
}

export async function getPreviousSignalDocument(
  workspaceId: string,
  canonicalUrl: string | null,
  before: Date,
) {
  if (!canonicalUrl) return null;
  const [row] = await previousSignalDocumentQuery(workspaceId, canonicalUrl, before);
  return row ?? null;
}

/**
 * Passed over without analysis, with the reason kept (R1/R2). Terminal like
 * "processed" so the sweep never re-dispatches it, but distinguishable: the
 * operator can see what was not read and why.
 */
export async function markSignalSkipped(
  workspaceId: string,
  signalId: string,
  reason: string,
) {
  await db
    .update(platinaSignalDocuments)
    .set({
      processingState: "processed",
      processingStartedAt: null,
      skipReason: reason.slice(0, 300),
    })
    .where(
      and(
        eq(platinaSignalDocuments.workspaceId, workspaceId),
        eq(platinaSignalDocuments.id, signalId),
      ),
    );
}

/** Mark a signal's contradiction round complete — the sweep never re-reads it. */
export async function markSignalProcessed(workspaceId: string, signalId: string) {
  await db
    .update(platinaSignalDocuments)
    .set({ processingState: "processed", processingStartedAt: null })
    .where(
      and(
        eq(platinaSignalDocuments.workspaceId, workspaceId),
        eq(platinaSignalDocuments.id, signalId),
      ),
    );
}

export async function listActiveAlertRules() {
  return db
    .select()
    .from(platinaAlertRules)
    .where(eq(platinaAlertRules.enabled, true));
}

// ---------------------------------------------------------------------------
// Slice 10 — alert rules CRUD + delivery ledger
// ---------------------------------------------------------------------------

export async function listAlertRules(workspaceId: string) {
  return allAlertRulesQuery(workspaceId);
}

export async function insertAlertRule(input: {
  workspaceId: string;
  name: string;
  source?: "outcome" | "finding" | "approval" | "run";
  conditions: { field: string; op: "gt" | "lt" | "eq" | "gte" | "lte"; value: number | string }[];
  severity: "info" | "warning" | "critical";
}) {
  const [row] = await db
    .insert(platinaAlertRules)
    .values({ ...input, actions: [] })
    .returning({ id: platinaAlertRules.id });
  return row.id;
}

export async function setAlertRuleEnabled(
  workspaceId: string,
  ruleId: string,
  enabled: boolean,
) {
  const updated = await db
    .update(platinaAlertRules)
    .set({ enabled })
    .where(
      and(
        eq(platinaAlertRules.workspaceId, workspaceId),
        eq(platinaAlertRules.id, ruleId),
      ),
    )
    .returning({ id: platinaAlertRules.id });
  return updated[0]?.id ?? null;
}

export async function insertAlertDelivery(input: {
  workspaceId: string;
  ruleId: string;
  severity: "info" | "warning" | "critical";
  route: "in_app";
  status: "sent" | "suppressed" | "failed";
  reason?: string | null;
}) {
  const [row] = await db
    .insert(platinaAlertDeliveries)
    .values(input)
    .returning({ id: platinaAlertDeliveries.id });
  return row.id;
}

export function alertDeliveriesQuery(workspaceId: string) {
  return db
    .select()
    .from(platinaAlertDeliveries)
    .where(eq(platinaAlertDeliveries.workspaceId, workspaceId))
    .orderBy(desc(platinaAlertDeliveries.createdAt))
    .limit(50);
}

export async function listAlertDeliveries(workspaceId: string) {
  return alertDeliveriesQuery(workspaceId);
}

/** Queue counts for operational alert sources (Slice 14). */
export async function countFindingsNeedingDecision(workspaceId: string) {
  const rows = await db
    .select({ id: platinaFindings.id })
    .from(platinaFindings)
    .where(
      and(
        eq(platinaFindings.workspaceId, workspaceId),
        eq(platinaFindings.status, "needs_decision"),
      ),
    );
  return rows.length;
}

export async function countPendingReceipts(workspaceId: string) {
  const rows = await db
    .select({ id: platinaReceipts.id })
    .from(platinaReceipts)
    .where(
      and(
        eq(platinaReceipts.workspaceId, workspaceId),
        eq(platinaReceipts.outcome, "pending"),
      ),
    );
  return rows.length;
}

export async function countFailedRunsSince(workspaceId: string, since: Date) {
  const rows = await db
    .select({ id: platinaAuditRuns.id })
    .from(platinaAuditRuns)
    .where(
      and(
        eq(platinaAuditRuns.workspaceId, workspaceId),
        inArray(platinaAuditRuns.status, ["failed", "degraded"]),
        sql`${platinaAuditRuns.queuedAt} >= ${since}`,
      ),
    );
  return rows.length;
}

/** Stamps the rule's last delivery — the 24h suppression window reads it. */
export async function markAlertRuleDelivered(
  workspaceId: string,
  ruleId: string,
) {
  await db
    .update(platinaAlertRules)
    .set({ lastRunAt: new Date() })
    .where(
      and(
        eq(platinaAlertRules.workspaceId, workspaceId),
        eq(platinaAlertRules.id, ruleId),
      ),
    );
}

// ---------------------------------------------------------------------------
// Slice 2 — workspace profile, audit runs, run events
// ---------------------------------------------------------------------------

export async function getWorkspaceProfile(workspaceId: string) {
  const rows = await db
    .select()
    .from(platinaWorkspaceProfiles)
    .where(eq(platinaWorkspaceProfiles.workspaceId, workspaceId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertWorkspaceProfile(
  workspaceId: string,
  patch: { division?: string; region?: string; businessUnit?: string },
) {
  const existing = await getWorkspaceProfile(workspaceId);
  if (existing) {
    await db
      .update(platinaWorkspaceProfiles)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(platinaWorkspaceProfiles.workspaceId, workspaceId));
    return existing.id;
  }
  const [row] = await db
    .insert(platinaWorkspaceProfiles)
    .values({ workspaceId, ...patch })
    .returning({ id: platinaWorkspaceProfiles.id });
  return row.id;
}

export function auditRunsQuery(workspaceId: string, limit = 20) {
  return db
    .select()
    .from(platinaAuditRuns)
    .where(eq(platinaAuditRuns.workspaceId, workspaceId))
    .orderBy(desc(platinaAuditRuns.queuedAt))
    .limit(limit);
}

export async function listAuditRuns(workspaceId: string, limit = 20) {
  return auditRunsQuery(workspaceId, limit);
}

export async function getAuditRun(workspaceId: string, runId: string) {
  const rows = await db
    .select()
    .from(platinaAuditRuns)
    .where(
      and(
        eq(platinaAuditRuns.workspaceId, workspaceId),
        eq(platinaAuditRuns.id, runId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export function auditRunEventsQuery(workspaceId: string, runId: string) {
  return db
    .select()
    .from(platinaAuditRunEvents)
    .where(
      and(
        eq(platinaAuditRunEvents.workspaceId, workspaceId),
        eq(platinaAuditRunEvents.runId, runId),
      ),
    )
    .orderBy(platinaAuditRunEvents.createdAt);
}

export async function listAuditRunEvents(workspaceId: string, runId: string) {
  return auditRunEventsQuery(workspaceId, runId);
}

export async function createAuditRun(input: {
  workspaceId: string;
  specId?: string | null;
  trigger: "manual" | "schedule" | "event";
  idempotencyKey: string;
  configSnapshot: PlatinaRunConfigSnapshot;
}) {
  const [row] = await db
    .insert(platinaAuditRuns)
    .values({
      workspaceId: input.workspaceId,
      specId: input.specId ?? null,
      trigger: input.trigger,
      idempotencyKey: input.idempotencyKey,
      configSnapshot: input.configSnapshot,
    })
    .onConflictDoNothing({
      target: [platinaAuditRuns.workspaceId, platinaAuditRuns.idempotencyKey],
    })
    .returning({ id: platinaAuditRuns.id });
  // A conflict means this exact run was already created — idempotent replay.
  return row?.id ?? null;
}

/**
 * Bounded transition: the update only applies when the run's current status
 * is in `from`. A mismatched guard returns null — illegal transitions are
 * unrepresentable rather than logged. Every successful transition appends
 * one event row to the timeline in the same workspace.
 */
export async function transitionAuditRun(input: {
  workspaceId: string;
  runId: string;
  from: readonly RunStatus[];
  to: RunStatus;
  message?: string;
  payload?: Record<string, unknown>;
  counters?: Record<string, number>;
  errorReason?: string;
  degradedReason?: string;
}) {
  const now = new Date();
  const updated = await db
    .update(platinaAuditRuns)
    .set({
      status: input.to,
      ...(input.to === "running" ? { startedAt: now } : {}),
      ...(input.to === "completed" ||
      input.to === "degraded" ||
      input.to === "failed"
        ? { finishedAt: now }
        : {}),
      ...(input.counters ? { counters: input.counters } : {}),
      ...(input.errorReason ? { errorReason: input.errorReason } : {}),
      ...(input.degradedReason ? { degradedReason: input.degradedReason } : {}),
    })
    .where(
      and(
        eq(platinaAuditRuns.workspaceId, input.workspaceId),
        eq(platinaAuditRuns.id, input.runId),
        inArray(platinaAuditRuns.status, input.from),
      ),
    )
    .returning({ id: platinaAuditRuns.id });
  if (updated.length === 0) return null;
  await db.insert(platinaAuditRunEvents).values({
    runId: input.runId,
    workspaceId: input.workspaceId,
    status: input.to,
    message: input.message,
    payload: input.payload,
  });
  return updated[0].id;
}

export async function markSpecLastRun(workspaceId: string, specId: string) {
  await db
    .update(platinaScanSpecs)
    .set({ lastRunAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(platinaScanSpecs.workspaceId, workspaceId),
        eq(platinaScanSpecs.id, specId),
      ),
    );
}

/**
 * Approved + enabled specs for the cadence coordinator. Deliberately a
 * global enumeration (reviewed exception, same class as
 * listApprovedScanSpecs): the coordinator fans out per spec, and every
 * downstream read/write is workspace-scoped by the row's workspace_id.
 */
export async function listSchedulableSpecs() {
  return db
    .select()
    .from(platinaScanSpecs)
    .where(
      and(
        eq(platinaScanSpecs.status, "approved"),
        eq(platinaScanSpecs.enabled, true),
      ),
    );
}

/** Probe-tier bookkeeping: validators and the last probe timestamp. */
export async function recordProbeState(
  workspaceId: string,
  specId: string,
  state: {
    etag?: string | null;
    lastModified?: string | null;
    currentIntervalMinutes?: number | null;
  },
) {
  await db
    .update(platinaScanSpecs)
    .set({
      lastProbeAt: new Date(),
      ...(state.etag !== undefined ? { probeEtag: state.etag } : {}),
      ...(state.lastModified !== undefined
        ? { probeLastModified: state.lastModified }
        : {}),
      ...(state.currentIntervalMinutes !== undefined
        ? { currentIntervalMinutes: state.currentIntervalMinutes }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(platinaScanSpecs.workspaceId, workspaceId),
        eq(platinaScanSpecs.id, specId),
      ),
    );
}

/**
 * Run-outcome bookkeeping on the source: freshness timestamps, the adaptive
 * cadence interval (tighten on new content, back off on unchanged), and the
 * daily cost-cap counters (reset each UTC day).
 */
export async function recordFetchOutcome(
  workspaceId: string,
  specId: string,
  // pages = pages/posts the run actually returned (cost is per page, not per
  // run); a failed or empty run still counts as one call.
  outcome: { inserted: number; failed: boolean; pages?: number },
  intervals: {
    tighten: (current: number | null, floor: number) => number;
    backoff: (current: number | null) => number;
  },
) {
  const spec = await getScanSpec(workspaceId, specId);
  if (!spec) return;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const cost = Math.max(1, outcome.pages ?? 1);
  const fetchesToday =
    spec.fetchesDay === today ? spec.fetchesToday + cost : cost;
  const changed = outcome.inserted > 0;
  await db
    .update(platinaScanSpecs)
    .set({
      lastRunAt: now,
      lastSuccessAt: outcome.failed ? spec.lastSuccessAt : now,
      lastFailureAt: outcome.failed ? now : spec.lastFailureAt,
      consecutiveUnchanged: outcome.failed
        ? spec.consecutiveUnchanged
        : changed
          ? 0
          : spec.consecutiveUnchanged + 1,
      currentIntervalMinutes: changed
        ? intervals.tighten(spec.currentIntervalMinutes, spec.cadenceMinutes)
        : intervals.backoff(spec.currentIntervalMinutes),
      fetchesDay: today,
      fetchesToday,
      updatedAt: now,
    })
    .where(
      and(
        eq(platinaScanSpecs.workspaceId, workspaceId),
        eq(platinaScanSpecs.id, specId),
      ),
    );
}

// ---------------------------------------------------------------------------
// Slice 3.5 — findings
// ---------------------------------------------------------------------------

export function findingsQuery(workspaceId: string) {
  return db
    .select()
    .from(platinaFindings)
    .where(eq(platinaFindings.workspaceId, workspaceId))
    .orderBy(desc(platinaFindings.createdAt));
}

export async function listFindings(workspaceId: string) {
  return findingsQuery(workspaceId);
}

export async function getFinding(workspaceId: string, findingId: string) {
  const rows = await db
    .select()
    .from(platinaFindings)
    .where(
      and(
        eq(platinaFindings.workspaceId, workspaceId),
        eq(platinaFindings.id, findingId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function insertFinding(input: {
  workspaceId: string;
  signalDocumentId?: string | null;
  transcriptId?: string | null;
  brainChunkId?: string | null;
  useCase?: string;
  title: string;
  summary: string;
  strongestObjection?: string | null;
  severity?: "critical" | "high" | "medium" | "low";
  evidence?: PlatinaFindingEvidence | null;
  status: "new" | "needs_decision";
}) {
  const [row] = await db
    .insert(platinaFindings)
    .values(input)
    .returning({ id: platinaFindings.id });
  return row.id;
}

/**
 * Guarded finding transition: the update only applies while the finding's
 * current status is in `from`. Illegal and repeat transitions return null —
 * they are unrepresentable, not logged. Every applied transition records the
 * human note and attribution.
 */
export async function transitionFinding(input: {
  workspaceId: string;
  findingId: string;
  from: readonly FindingStatus[];
  to: "validated" | "refuted" | "dismissed" | "superseded";
  ruling: string;
  ruledBy: string;
}) {
  const updated = await db
    .update(platinaFindings)
    .set({
      status: input.to,
      humanRuling: input.ruling,
      ruledBy: input.ruledBy,
      ruledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(platinaFindings.workspaceId, input.workspaceId),
        eq(platinaFindings.id, input.findingId),
        inArray(platinaFindings.status, input.from),
      ),
    )
    .returning({ id: platinaFindings.id });
  return updated[0]?.id ?? null;
}

/** Recent debate transcripts for the objection-rate window (R5.1). */
export function debateTranscriptsQuery(workspaceId: string, limit = 20) {
  return db
    .select()
    .from(platinaDebateTranscripts)
    .where(eq(platinaDebateTranscripts.workspaceId, workspaceId))
    .orderBy(desc(platinaDebateTranscripts.createdAt))
    .limit(limit);
}

export async function listDebateTranscripts(workspaceId: string, limit = 20) {
  return debateTranscriptsQuery(workspaceId, limit);
}

/** Open operational findings — the objection-rate alarm dedupes on these. */
export async function listOpenOperationalFindings(workspaceId: string) {
  return db
    .select()
    .from(platinaFindings)
    .where(
      and(
        eq(platinaFindings.workspaceId, workspaceId),
        eq(platinaFindings.useCase, "operational"),
        inArray(platinaFindings.status, ["new", "needs_decision"]),
      ),
    );
}

/**
 * Lexical (BM25-style) candidates via Postgres full-text search (R4.4).
 * Exact strings — instrument model numbers, method codes, catalogue
 * references — that pure vector search misses. Plane A only; Plane B stays
 * structurally unsearchable.
 */
export function lexicalBrandChunksQuery(
  workspaceId: string,
  query: string,
  limit = 20,
) {
  const tsQuery = sql`plainto_tsquery('english', ${query})`;
  return db
    .select({
      id: platinaBrandChunks.id,
      content: platinaBrandChunks.content,
      rank: sql<number>`ts_rank(to_tsvector('english', ${platinaBrandChunks.content}), ${tsQuery})`,
    })
    .from(platinaBrandChunks)
    .where(
      and(
        eq(platinaBrandChunks.workspaceId, workspaceId),
        isNull(platinaBrandChunks.supersededAt),
        eq(
          platinaBrandChunks.embeddingModelVersion,
          PLATINA_EMBEDDING_MODEL_VERSION,
        ),
        sql`to_tsvector('english', ${platinaBrandChunks.content}) @@ ${tsQuery}`,
      ),
    )
    .orderBy(
      desc(
        sql`ts_rank(to_tsvector('english', ${platinaBrandChunks.content}), ${tsQuery})`,
      ),
    )
    .limit(limit);
}

export function lexicalBrainChunksQuery(
  workspaceId: string,
  query: string,
  limit = 20,
) {
  const tsQuery = sql`plainto_tsquery('english', ${query})`;
  return db
    .select({
      id: platinaBrainChunks.id,
      content: platinaBrainChunks.content,
      confidence: platinaBrainChunks.confidence,
      generation: platinaBrainChunks.generation,
      rank: sql<number>`ts_rank(to_tsvector('english', ${platinaBrainChunks.content}), ${tsQuery})`,
    })
    .from(platinaBrainChunks)
    .where(
      and(
        eq(platinaBrainChunks.workspaceId, workspaceId),
        eq(platinaBrainChunks.status, "active"),
        eq(
          platinaBrainChunks.embeddingModelVersion,
          PLATINA_EMBEDDING_MODEL_VERSION,
        ),
        sql`to_tsvector('english', ${platinaBrainChunks.content}) @@ ${tsQuery}`,
      ),
    )
    .orderBy(
      desc(
        sql`ts_rank(to_tsvector('english', ${platinaBrainChunks.content}), ${tsQuery})`,
      ),
    )
    .limit(limit);
}

/** First-party outcomes only — synthetic demo rows are never evidence (A4). */
export function firstPartyOutcomesQuery(workspaceId: string) {
  return db
    .select()
    .from(platinaOutcomes)
    .where(
      and(
        eq(platinaOutcomes.workspaceId, workspaceId),
        eq(platinaOutcomes.synthetic, false),
      ),
    )
    .orderBy(desc(platinaOutcomes.recordedAt));
}

/**
 * Citation validation (Slice 5): the approval form's evidence ids arrive as
 * hidden form fields — client-tamperable. Every cited id must exist as a row
 * in THIS workspace; foreign or fabricated ids are returned so the action
 * can refuse.
 */
export async function findInvalidCitationIds(
  workspaceId: string,
  brandIds: string[],
  brainIds: string[],
): Promise<string[]> {
  const invalid: string[] = [];
  if (brandIds.length > 0) {
    const rows = await db
      .select({ id: platinaBrandChunks.id })
      .from(platinaBrandChunks)
      .where(
        and(
          eq(platinaBrandChunks.workspaceId, workspaceId),
          inArray(platinaBrandChunks.id, brandIds),
        ),
      );
    const found = new Set(rows.map((r) => r.id));
    invalid.push(...brandIds.filter((id) => !found.has(id)));
  }
  if (brainIds.length > 0) {
    const rows = await db
      .select({ id: platinaBrainChunks.id })
      .from(platinaBrainChunks)
      .where(
        and(
          eq(platinaBrainChunks.workspaceId, workspaceId),
          inArray(platinaBrainChunks.id, brainIds),
        ),
      );
    const found = new Set(rows.map((r) => r.id));
    invalid.push(...brainIds.filter((id) => !found.has(id)));
  }
  return invalid;
}

/** Eval-harness hygiene (R5.2): remove only the harness's own seeded rows,
 * identified by the eval:// source prefix, in the given workspace. Nothing
 * else is deletable through this path.
 */
export async function deleteEvalBrandChunks(workspaceId: string) {
  await db
    .delete(platinaBrandChunks)
    .where(
      and(
        eq(platinaBrandChunks.workspaceId, workspaceId),
        sql`${platinaBrandChunks.sourceUrl} LIKE 'eval://%'`,
      ),
    );
}

// ---------------------------------------------------------------------------
// Slice 6 — solution tasks
// ---------------------------------------------------------------------------

export function solutionTasksQuery(workspaceId: string, campaignId: string) {
  return db
    .select()
    .from(platinaSolutionTasks)
    .where(
      and(
        eq(platinaSolutionTasks.workspaceId, workspaceId),
        eq(platinaSolutionTasks.campaignId, campaignId),
      ),
    )
    .orderBy(platinaSolutionTasks.createdAt);
}

export async function listSolutionTasks(
  workspaceId: string,
  campaignId: string,
) {
  return solutionTasksQuery(workspaceId, campaignId);
}

export async function insertSolutionTask(input: {
  workspaceId: string;
  campaignId: string;
  title: string;
  assigneeId?: string | null;
  dueDate?: Date | null;
  eventPhase?: "pre" | "at" | "post" | null;
  risk?: string | null;
  claimsBlocked?: boolean;
}) {
  const [row] = await db
    .insert(platinaSolutionTasks)
    .values(input)
    .returning({ id: platinaSolutionTasks.id });
  return row.id;
}

/** Board moves and edits are guarded by workspace + task id. */
export async function updateSolutionTask(
  workspaceId: string,
  taskId: string,
  patch: {
    status?: "todo" | "in_progress" | "blocked" | "review" | "done";
    assigneeId?: string | null;
    dueDate?: Date | null;
    eventPhase?: "pre" | "at" | "post" | null;
    risk?: string | null;
    claimsBlocked?: boolean;
    title?: string;
  },
) {
  const updated = await db
    .update(platinaSolutionTasks)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(platinaSolutionTasks.workspaceId, workspaceId),
        eq(platinaSolutionTasks.id, taskId),
      ),
    )
    .returning({ id: platinaSolutionTasks.id });
  return updated[0]?.id ?? null;
}

/** Titles of already-materialized template tasks (idempotency check). */
export async function listTemplateTaskTitles(
  workspaceId: string,
  campaignId: string,
) {
  const rows = await db
    .select({ title: platinaSolutionTasks.title })
    .from(platinaSolutionTasks)
    .where(
      and(
        eq(platinaSolutionTasks.workspaceId, workspaceId),
        eq(platinaSolutionTasks.campaignId, campaignId),
        sql`${platinaSolutionTasks.eventPhase} IS NOT NULL`,
      ),
    );
  return new Set(rows.map((r) => r.title));
}

/** A recorded claims exception for this campaign (named approver + reason). */
export async function hasClaimsException(
  workspaceId: string,
  campaignId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: platinaGateEvents.id })
    .from(platinaGateEvents)
    .where(
      and(
        eq(platinaGateEvents.workspaceId, workspaceId),
        eq(platinaGateEvents.subjectType, "claims_exception"),
        eq(platinaGateEvents.subjectId, campaignId),
        eq(platinaGateEvents.decision, "approved"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function getReceipt(workspaceId: string, receiptId: string) {
  const rows = await db
    .select()
    .from(platinaReceipts)
    .where(
      and(
        eq(platinaReceipts.workspaceId, workspaceId),
        eq(platinaReceipts.id, receiptId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getBrandChunksByIds(workspaceId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(platinaBrandChunks)
    .where(
      and(
        eq(platinaBrandChunks.workspaceId, workspaceId),
        inArray(platinaBrandChunks.id, ids),
      ),
    );
}

export async function getBrainChunksByIds(workspaceId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(platinaBrainChunks)
    .where(
      and(
        eq(platinaBrainChunks.workspaceId, workspaceId),
        inArray(platinaBrainChunks.id, ids),
      ),
    );
}

/** Gate events for one subject (a campaign's decision history). */
export function gateEventsForSubjectQuery(workspaceId: string, subjectId: string) {
  return db
    .select()
    .from(platinaGateEvents)
    .where(
      and(
        eq(platinaGateEvents.workspaceId, workspaceId),
        eq(platinaGateEvents.subjectId, subjectId),
      ),
    )
    .orderBy(platinaGateEvents.createdAt);
}

export async function listGateEventsForSubject(
  workspaceId: string,
  subjectId: string,
) {
  return gateEventsForSubjectQuery(workspaceId, subjectId);
}

/** Synthetic outcome ids — the A4 guard input for packet building. */
export async function listSyntheticOutcomeIds(
  workspaceId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: platinaOutcomes.id })
    .from(platinaOutcomes)
    .where(
      and(
        eq(platinaOutcomes.workspaceId, workspaceId),
        eq(platinaOutcomes.synthetic, true),
      ),
    );
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Slice 9 — outcome imports
// ---------------------------------------------------------------------------

export async function insertOutcomeImport(input: {
  workspaceId: string;
  source: string;
  fileHash: string;
  status: "completed" | "failed";
  rowCount: number;
  insertedCount: number;
  skippedCount: number;
  errors: string[];
  createdById: string;
}) {
  const [row] = await db
    .insert(platinaOutcomeImports)
    .values(input)
    .returning({ id: platinaOutcomeImports.id });
  return row.id;
}

export function outcomeImportsQuery(workspaceId: string) {
  return db
    .select()
    .from(platinaOutcomeImports)
    .where(eq(platinaOutcomeImports.workspaceId, workspaceId))
    .orderBy(desc(platinaOutcomeImports.createdAt));
}

export async function listOutcomeImports(workspaceId: string) {
  return outcomeImportsQuery(workspaceId);
}

/**
 * Existing outcome rows in the shape the row-hash dedupe consumes. Hashing
 * is computed in JS from the same normalized fields — no hash column needed.
 */
export async function listOutcomeDedupeRows(workspaceId: string) {
  return db
    .select({
      leads: platinaOutcomes.leads,
      qualifiedLeads: platinaOutcomes.qualifiedLeads,
      conversionRate: platinaOutcomes.conversionRate,
      pipelineContribution: platinaOutcomes.pipelineContribution,
      campaignId: platinaOutcomes.campaignId,
      receiptId: platinaOutcomes.receiptId,
      recordedAt: platinaOutcomes.recordedAt,
    })
    .from(platinaOutcomes)
    .where(eq(platinaOutcomes.workspaceId, workspaceId));
}

export { sql };

// ---------------------------------------------------------------------------
// Slice 8 — brand sources and workspace claims rules
// ---------------------------------------------------------------------------

export function brandSourcesQuery(workspaceId: string) {
  return db
    .select()
    .from(platinaBrandSources)
    .where(eq(platinaBrandSources.workspaceId, workspaceId))
    .orderBy(desc(platinaBrandSources.createdAt));
}

export async function listBrandSources(workspaceId: string) {
  return brandSourcesQuery(workspaceId);
}

export async function listApprovedBrandSources(workspaceId: string) {
  return db
    .select()
    .from(platinaBrandSources)
    .where(
      and(
        eq(platinaBrandSources.workspaceId, workspaceId),
        eq(platinaBrandSources.status, "approved"),
      ),
    );
}

export async function getBrandSource(workspaceId: string, sourceId: string) {
  const rows = await db
    .select()
    .from(platinaBrandSources)
    .where(
      and(
        eq(platinaBrandSources.workspaceId, workspaceId),
        eq(platinaBrandSources.id, sourceId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function insertBrandSource(input: {
  workspaceId: string;
  title: string;
  url?: string | null;
  createdById: string;
}) {
  const [row] = await db
    .insert(platinaBrandSources)
    .values(input)
    .returning({ id: platinaBrandSources.id });
  return row.id;
}

export async function approveBrandSource(workspaceId: string, sourceId: string) {
  await db
    .update(platinaBrandSources)
    .set({ status: "approved", updatedAt: new Date() })
    .where(
      and(
        eq(platinaBrandSources.workspaceId, workspaceId),
        eq(platinaBrandSources.id, sourceId),
      ),
    );
}

/** Freshness bookkeeping. `changed` rotates the content hash and stamps
 *  last_changed_at; every fetch stamps last_fetched_at. */
export async function recordBrandSourceFetch(
  workspaceId: string,
  sourceId: string,
  outcome: { contentHash: string; changed: boolean },
) {
  const now = new Date();
  await db
    .update(platinaBrandSources)
    .set({
      lastFetchedAt: now,
      ...(outcome.changed
        ? { contentHash: outcome.contentHash, lastChangedAt: now }
        : {}),
      updatedAt: now,
    })
    .where(
      and(
        eq(platinaBrandSources.workspaceId, workspaceId),
        eq(platinaBrandSources.id, sourceId),
      ),
    );
}

/** Supersede all current chunks from a source — called with the ids of the
 *  freshly inserted replacement chunks excluded, so a refresh can never
 *  supersede what it just wrote. */
export async function supersedeBrandChunksForSource(
  workspaceId: string,
  sourceUrl: string,
  excludeIds: string[] = [],
) {
  await db
    .update(platinaBrandChunks)
    .set({ supersededAt: new Date() })
    .where(
      and(
        eq(platinaBrandChunks.workspaceId, workspaceId),
        eq(platinaBrandChunks.sourceUrl, sourceUrl),
        isNull(platinaBrandChunks.supersededAt),
        ...(excludeIds.length > 0
          ? [notInArray(platinaBrandChunks.id, excludeIds)]
          : []),
      ),
    );
}

export function claimsRulesQuery(workspaceId: string) {
  return db
    .select()
    .from(platinaClaimsRules)
    .where(eq(platinaClaimsRules.workspaceId, workspaceId))
    .orderBy(desc(platinaClaimsRules.createdAt));
}

export async function listActiveClaimsRules(workspaceId: string) {
  return db
    .select()
    .from(platinaClaimsRules)
    .where(
      and(
        eq(platinaClaimsRules.workspaceId, workspaceId),
        eq(platinaClaimsRules.active, true),
      ),
    );
}

export async function insertClaimsRule(input: {
  workspaceId: string;
  kind: "banned_term" | "regulated_claim";
  term: string;
  note?: string | null;
  createdById: string;
}) {
  const [row] = await db
    .insert(platinaClaimsRules)
    .values(input)
    .returning({ id: platinaClaimsRules.id });
  return row.id;
}

/** Rules are archived, never deleted — the audit trail keeps the reason. */
export async function archiveClaimsRule(workspaceId: string, ruleId: string) {
  const updated = await db
    .update(platinaClaimsRules)
    .set({ active: false })
    .where(
      and(
        eq(platinaClaimsRules.workspaceId, workspaceId),
        eq(platinaClaimsRules.id, ruleId),
      ),
    )
    .returning({ id: platinaClaimsRules.id });
  return updated[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Campaign planner. Every query filters workspace_id (constitution); the
// feedback join filters it on BOTH tables so a forged planId can't cross
// tenants.
// ---------------------------------------------------------------------------

export function plansWithVerdictQuery(workspaceId: string, limit = 30) {
  return db
    .select({
      id: platinaPlans.id,
      title: platinaPlans.title,
      brief: platinaPlans.brief,
      lessonsUsed: platinaPlans.lessonsUsed,
      createdAt: platinaPlans.createdAt,
      brandId: platinaPlans.brandId,
      origin: platinaPlans.origin,
      parentPlanId: platinaPlans.parentPlanId,
      verdict: platinaPlanFeedback.verdict,
    })
    .from(platinaPlans)
    .leftJoin(
      platinaPlanFeedback,
      and(
        eq(platinaPlanFeedback.planId, platinaPlans.id),
        eq(platinaPlanFeedback.workspaceId, workspaceId),
      ),
    )
    .where(eq(platinaPlans.workspaceId, workspaceId))
    .orderBy(desc(platinaPlans.createdAt))
    .limit(limit);
}

export async function listPlansWithVerdict(workspaceId: string, limit = 30) {
  return plansWithVerdictQuery(workspaceId, limit);
}

export function planByIdQuery(workspaceId: string, planId: string) {
  return db
    .select()
    .from(platinaPlans)
    .where(
      and(eq(platinaPlans.workspaceId, workspaceId), eq(platinaPlans.id, planId)),
    )
    .limit(1);
}

export async function getPlan(workspaceId: string, planId: string) {
  const rows = await planByIdQuery(workspaceId, planId);
  return rows[0] ?? null;
}

export function planFeedbackQuery(workspaceId: string, planId: string) {
  return db
    .select()
    .from(platinaPlanFeedback)
    .where(
      and(
        eq(platinaPlanFeedback.workspaceId, workspaceId),
        eq(platinaPlanFeedback.planId, planId),
      ),
    )
    .limit(1);
}

export async function getPlanFeedback(workspaceId: string, planId: string) {
  const rows = await planFeedbackQuery(workspaceId, planId);
  return rows[0] ?? null;
}

export async function insertPlan(input: {
  workspaceId: string;
  title: string;
  brief: string;
  plan: PlanDoc;
  critique: string[];
  lessonsUsed: number;
  createdById: string | null;
  brandId?: string | null;
  origin?: PlanOrigin | null;
  parentPlanId?: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(platinaPlans)
    .values(input)
    .returning({ id: platinaPlans.id });
  return row.id;
}

/**
 * Record what happened. Verifies the plan belongs to the workspace first, so
 * a forged planId from another tenant is rejected rather than written.
 */
export async function upsertPlanFeedback(input: {
  workspaceId: string;
  planId: string;
  verdict: PlanVerdict;
  note: string | null;
  createdById: string | null;
}) {
  const plan = await getPlan(input.workspaceId, input.planId);
  if (!plan) throw new Error("Plan not found");
  await db
    .insert(platinaPlanFeedback)
    .values(input)
    .onConflictDoUpdate({
      target: platinaPlanFeedback.planId,
      set: {
        verdict: input.verdict,
        note: input.note,
        createdById: input.createdById,
        createdAt: new Date(),
      },
    });
}

/** Lessons for the planner: plans in this workspace with a given verdict. */
export function planLessonsQuery(
  workspaceId: string,
  verdict: PlanVerdict,
  limit: number,
) {
  return db
    .select({
      title: platinaPlans.title,
      brief: platinaPlans.brief,
      plan: platinaPlans.plan,
      note: platinaPlanFeedback.note,
    })
    .from(platinaPlanFeedback)
    .innerJoin(
      platinaPlans,
      and(
        eq(platinaPlans.id, platinaPlanFeedback.planId),
        eq(platinaPlans.workspaceId, workspaceId),
      ),
    )
    .where(
      and(
        eq(platinaPlanFeedback.workspaceId, workspaceId),
        eq(platinaPlanFeedback.verdict, verdict),
      ),
    )
    .orderBy(desc(platinaPlanFeedback.createdAt))
    .limit(limit);
}

export async function listPlanLessons(
  workspaceId: string,
  verdict: PlanVerdict,
  limit = 3,
) {
  return planLessonsQuery(workspaceId, verdict, limit);
}

// ---------------------------------------------------------------------------
// Health (core spine S0) — cheap, workspace-scoped counters for the health page
// ---------------------------------------------------------------------------

export function docsSinceQuery(workspaceId: string, since: Date) {
  return db
    .select({ n: count() })
    .from(platinaSignalDocuments)
    .where(
      and(
        eq(platinaSignalDocuments.workspaceId, workspaceId),
        gte(platinaSignalDocuments.createdAt, since),
      ),
    );
}

export function findingsSinceQuery(workspaceId: string, since: Date) {
  return db
    .select({ n: count() })
    .from(platinaFindings)
    .where(
      and(
        eq(platinaFindings.workspaceId, workspaceId),
        gte(platinaFindings.createdAt, since),
      ),
    );
}

export function latestRunEventQuery(workspaceId: string) {
  return db
    .select({ at: max(platinaAuditRunEvents.createdAt) })
    .from(platinaAuditRunEvents)
    .where(eq(platinaAuditRunEvents.workspaceId, workspaceId));
}

export async function countDocsSince(workspaceId: string, since: Date) {
  return (await docsSinceQuery(workspaceId, since))[0]?.n ?? 0;
}

export async function countFindingsSince(workspaceId: string, since: Date) {
  return (await findingsSinceQuery(workspaceId, since))[0]?.n ?? 0;
}

export async function getLatestRunEventAt(workspaceId: string) {
  return (await latestRunEventQuery(workspaceId))[0]?.at ?? null;
}

/** Round-trip probe. Not workspace data — touches no table. */
export async function pingDatabase() {
  await db.execute(sql`select 1`);
}

// ---------------------------------------------------------------------------
// Brands (core spine S1) — every read is workspace-scoped in the query itself.
// ---------------------------------------------------------------------------

export function brandsQuery(workspaceId: string) {
  return db
    .select()
    .from(platinaBrands)
    .where(eq(platinaBrands.workspaceId, workspaceId))
    .orderBy(platinaBrands.name);
}

export function brandByIdQuery(workspaceId: string, brandId: string) {
  return db
    .select()
    .from(platinaBrands)
    .where(
      and(
        eq(platinaBrands.workspaceId, workspaceId),
        eq(platinaBrands.id, brandId),
      ),
    )
    .limit(1);
}

export function competitorsOfQuery(workspaceId: string, parentBrandId: string) {
  return db
    .select()
    .from(platinaBrands)
    .where(
      and(
        eq(platinaBrands.workspaceId, workspaceId),
        eq(platinaBrands.kind, "competitor"),
        eq(platinaBrands.parentBrandId, parentBrandId),
      ),
    )
    .orderBy(platinaBrands.name);
}

export function scanSpecsForBrandQuery(workspaceId: string, brandId: string) {
  return db
    .select()
    .from(platinaScanSpecs)
    .where(
      and(
        eq(platinaScanSpecs.workspaceId, workspaceId),
        eq(platinaScanSpecs.brandId, brandId),
      ),
    )
    .orderBy(desc(platinaScanSpecs.createdAt));
}

export async function listBrands(workspaceId: string) {
  return brandsQuery(workspaceId);
}

export async function getBrand(workspaceId: string, brandId: string) {
  return (await brandByIdQuery(workspaceId, brandId))[0] ?? null;
}

export async function listCompetitorsOf(
  workspaceId: string,
  parentBrandId: string,
) {
  return competitorsOfQuery(workspaceId, parentBrandId);
}

export async function listScanSpecsForBrand(
  workspaceId: string,
  brandId: string,
) {
  return scanSpecsForBrandQuery(workspaceId, brandId);
}

export async function createBrand(input: {
  workspaceId: string;
  name: string;
  kind?: "own_brand" | "competitor";
  parentBrandId?: string | null;
  homepageUrl?: string | null;
  handles?: PlatinaBrandHandles;
  region?: string | null;
  notes?: string | null;
  createdById: string;
}) {
  // A competitor must hang off an own_brand in the SAME workspace — enforced
  // here because parent_brand_id deliberately has no foreign key.
  if (input.parentBrandId) {
    const parent = await getBrand(input.workspaceId, input.parentBrandId);
    if (!parent || parent.kind !== "own_brand") {
      throw new Error("competitor parent must be an own brand in this workspace");
    }
  }
  const [row] = await db
    .insert(platinaBrands)
    .values({
      ...input,
      kind: input.kind ?? "own_brand",
      parentBrandId: input.parentBrandId ?? null,
    })
    .returning({ id: platinaBrands.id });
  return row.id;
}

export async function updateBrand(
  workspaceId: string,
  brandId: string,
  patch: Partial<{
    name: string;
    homepageUrl: string | null;
    handles: PlatinaBrandHandles;
    region: string | null;
    notes: string | null;
    status: "active" | "paused";
  }>,
) {
  await db
    .update(platinaBrands)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(platinaBrands.workspaceId, workspaceId),
        eq(platinaBrands.id, brandId),
      ),
    );
}

// ---------------------------------------------------------------------------
// Spend control (core spine S3) — pages collected today across the workspace.
// ---------------------------------------------------------------------------

export function pagesTodayQuery(workspaceId: string, day: string) {
  return db
    .select({ pages: sql<number>`coalesce(sum(${platinaScanSpecs.fetchesToday}), 0)::int` })
    .from(platinaScanSpecs)
    .where(
      and(
        eq(platinaScanSpecs.workspaceId, workspaceId),
        eq(platinaScanSpecs.fetchesDay, day),
      ),
    );
}

export async function getWorkspacePagesToday(workspaceId: string, day: string) {
  return (await pagesTodayQuery(workspaceId, day))[0]?.pages ?? 0;
}

// ---------------------------------------------------------------------------
// Throughput (core spine S4)
// ---------------------------------------------------------------------------

export function transcriptsSinceQuery(workspaceId: string, since: Date) {
  return db
    .select({ n: count() })
    .from(platinaDebateTranscripts)
    .where(
      and(
        eq(platinaDebateTranscripts.workspaceId, workspaceId),
        gte(platinaDebateTranscripts.createdAt, since),
      ),
    );
}

export async function countTranscriptsSince(workspaceId: string, since: Date) {
  return (await transcriptsSinceQuery(workspaceId, since))[0]?.n ?? 0;
}

/**
 * Atomically takes a signal for analysis: only one caller can flip it from
 * unprocessed to processing, so a double-dispatch analyses it once.
 */
export async function claimSignal(
  workspaceId: string,
  signalId: string,
  staleBefore: Date = staleClaimCutoff(),
) {
  const rows = await db
    .update(platinaSignalDocuments)
    .set({ processingState: "processing", processingStartedAt: new Date() })
    .where(
      and(
        eq(platinaSignalDocuments.workspaceId, workspaceId),
        eq(platinaSignalDocuments.id, signalId),
        // Only one caller wins; a claim held by a dead worker can be taken over.
        analysisPending(staleBefore),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/** Hands a claimed signal back after a failed analysis so the next sweep retries it. */
export async function releaseSignal(workspaceId: string, signalId: string) {
  await db
    .update(platinaSignalDocuments)
    .set({ processingState: "unprocessed", processingStartedAt: null })
    .where(
      and(
        eq(platinaSignalDocuments.workspaceId, workspaceId),
        eq(platinaSignalDocuments.id, signalId),
        eq(platinaSignalDocuments.processingState, "processing"),
      ),
    );
}

// ---------------------------------------------------------------------------
// Evidence provenance (core spine S5/S6) — light reads, never the embedding.
// ---------------------------------------------------------------------------

export function recentBrainEvidenceQuery(workspaceId: string, limit: number) {
  return db
    .select({
      id: platinaBrainChunks.id,
      content: platinaBrainChunks.content,
      confidence: platinaBrainChunks.confidence,
      sourceSignalIds: platinaBrainChunks.sourceSignalIds,
      createdAt: platinaBrainChunks.createdAt,
    })
    .from(platinaBrainChunks)
    .where(
      and(
        eq(platinaBrainChunks.workspaceId, workspaceId),
        eq(platinaBrainChunks.status, "active"),
      ),
    )
    .orderBy(desc(platinaBrainChunks.createdAt))
    .limit(limit);
}

/**
 * The declared brand standard. With a brandId it is that client's standard
 * only — workspace-wide brand text belongs to no client and must not be
 * compared against another client's competitors (R3).
 */
export function recentBrandEvidenceQuery(
  workspaceId: string,
  limit: number,
  brandId?: string | null,
) {
  return db
    .select({
      id: platinaBrandChunks.id,
      content: platinaBrandChunks.content,
      sourceUrl: platinaBrandChunks.sourceUrl,
      createdAt: platinaBrandChunks.createdAt,
    })
    .from(platinaBrandChunks)
    .where(
      and(
        eq(platinaBrandChunks.workspaceId, workspaceId),
        isNull(platinaBrandChunks.supersededAt),
        ...(brandId ? [eq(platinaBrandChunks.brandId, brandId)] : []),
      ),
    )
    .orderBy(desc(platinaBrandChunks.createdAt))
    .limit(limit);
}

export function signalProvenanceQuery(workspaceId: string, ids: string[]) {
  return db
    .select({
      id: platinaSignalDocuments.id,
      sourceUrl: platinaSignalDocuments.sourceUrl,
      fetchedAt: platinaSignalDocuments.fetchedAt,
    })
    .from(platinaSignalDocuments)
    .where(
      and(
        eq(platinaSignalDocuments.workspaceId, workspaceId),
        inArray(platinaSignalDocuments.id, ids),
      ),
    );
}

export async function listRecentBrainEvidence(workspaceId: string, limit = 12) {
  return recentBrainEvidenceQuery(workspaceId, limit);
}

export async function listRecentBrandEvidence(
  workspaceId: string,
  limit = 12,
  brandId?: string | null,
) {
  return recentBrandEvidenceQuery(workspaceId, limit, brandId);
}

export async function listSignalProvenance(workspaceId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return signalProvenanceQuery(workspaceId, ids);
}

export function findingTitleExistsQuery(
  workspaceId: string,
  useCase: string,
  title: string,
) {
  return db
    .select({ id: platinaFindings.id })
    .from(platinaFindings)
    .where(
      and(
        eq(platinaFindings.workspaceId, workspaceId),
        eq(platinaFindings.useCase, useCase),
        eq(platinaFindings.title, title),
        inArray(platinaFindings.status, ["new", "needs_decision", "validated"]),
      ),
    )
    .limit(1);
}

/** Stage reruns are frequent; an open finding with the same title is not repeated. */
export async function findingTitleExists(
  workspaceId: string,
  useCase: string,
  title: string,
) {
  return (await findingTitleExistsQuery(workspaceId, useCase, title)).length > 0;
}

// ---------------------------------------------------------------------------
// Per-brand views (core spine S7). Joins carry workspace_id on EVERY table.
// ---------------------------------------------------------------------------

export function findingsForBrandsQuery(
  workspaceId: string,
  brandIds: string[],
  limit = 10,
) {
  return db
    .select({
      id: platinaFindings.id,
      title: platinaFindings.title,
      summary: platinaFindings.summary,
      severity: platinaFindings.severity,
      status: platinaFindings.status,
      useCase: platinaFindings.useCase,
      createdAt: platinaFindings.createdAt,
    })
    .from(platinaFindings)
    .innerJoin(
      platinaSignalDocuments,
      eq(platinaFindings.signalDocumentId, platinaSignalDocuments.id),
    )
    .innerJoin(
      platinaScanSpecs,
      eq(platinaSignalDocuments.scanSpecId, platinaScanSpecs.id),
    )
    .where(
      and(
        eq(platinaFindings.workspaceId, workspaceId),
        eq(platinaSignalDocuments.workspaceId, workspaceId),
        eq(platinaScanSpecs.workspaceId, workspaceId),
        inArray(platinaScanSpecs.brandId, brandIds),
      ),
    )
    .orderBy(desc(platinaFindings.createdAt))
    .limit(limit);
}

export function docCountForBrandsQuery(workspaceId: string, brandIds: string[]) {
  return db
    .select({ n: count() })
    .from(platinaSignalDocuments)
    .innerJoin(
      platinaScanSpecs,
      eq(platinaSignalDocuments.scanSpecId, platinaScanSpecs.id),
    )
    .where(
      and(
        eq(platinaSignalDocuments.workspaceId, workspaceId),
        eq(platinaScanSpecs.workspaceId, workspaceId),
        inArray(platinaScanSpecs.brandId, brandIds),
      ),
    );
}

export async function listFindingsForBrands(
  workspaceId: string,
  brandIds: string[],
  limit = 10,
) {
  if (brandIds.length === 0) return [];
  return findingsForBrandsQuery(workspaceId, brandIds, limit);
}

export async function countDocsForBrands(workspaceId: string, brandIds: string[]) {
  if (brandIds.length === 0) return 0;
  return (await docCountForBrandsQuery(workspaceId, brandIds))[0]?.n ?? 0;
}

export function latestDocumentQuery(workspaceId: string) {
  return db
    .select({ at: max(platinaSignalDocuments.fetchedAt) })
    .from(platinaSignalDocuments)
    .where(eq(platinaSignalDocuments.workspaceId, workspaceId));
}

export async function getLatestDocumentAt(workspaceId: string) {
  return (await latestDocumentQuery(workspaceId))[0]?.at ?? null;
}

// ---------------------------------------------------------------------------
// Real-time planning (client-scoped evidence, plan freshness, provider notice)
// ---------------------------------------------------------------------------

/** Signal documents collected for these brands (a client and its competitors). */
/**
 * Collected documents that carry engagement measurements, per brand (R4).
 * Joined through the scan spec, so a document is attributed to the brand whose
 * source produced it. Workspace-filtered on both sides of the join.
 */
export function engagementDocsForBrandsQuery(
  workspaceId: string,
  brandIds: string[],
  limit = 200,
) {
  return db
    .select({
      brandId: platinaScanSpecs.brandId,
      metrics: platinaSignalDocuments.metrics,
      fetchedAt: platinaSignalDocuments.fetchedAt,
    })
    .from(platinaSignalDocuments)
    .innerJoin(
      platinaScanSpecs,
      eq(platinaSignalDocuments.scanSpecId, platinaScanSpecs.id),
    )
    .where(
      and(
        eq(platinaSignalDocuments.workspaceId, workspaceId),
        eq(platinaScanSpecs.workspaceId, workspaceId),
        inArray(platinaScanSpecs.brandId, brandIds),
        isNotNull(platinaSignalDocuments.metrics),
      ),
    )
    .orderBy(desc(platinaSignalDocuments.fetchedAt))
    .limit(limit);
}

export async function listEngagementDocsForBrands(
  workspaceId: string,
  brandIds: string[],
  limit = 200,
) {
  if (brandIds.length === 0) return [];
  return engagementDocsForBrandsQuery(workspaceId, brandIds, limit);
}

export function signalIdsForBrandsQuery(
  workspaceId: string,
  brandIds: string[],
  limit = 5000,
) {
  return db
    .select({ id: platinaSignalDocuments.id })
    .from(platinaSignalDocuments)
    .innerJoin(
      platinaScanSpecs,
      eq(platinaSignalDocuments.scanSpecId, platinaScanSpecs.id),
    )
    .where(
      and(
        eq(platinaSignalDocuments.workspaceId, workspaceId),
        eq(platinaScanSpecs.workspaceId, workspaceId),
        inArray(platinaScanSpecs.brandId, brandIds),
      ),
    )
    .orderBy(desc(platinaSignalDocuments.fetchedAt))
    .limit(limit);
}

export async function listSignalIdsForBrands(
  workspaceId: string,
  brandIds: string[],
) {
  if (brandIds.length === 0) return [];
  return (await signalIdsForBrandsQuery(workspaceId, brandIds)).map((r) => r.id);
}

/** Validated Brain chunks written after a moment — "what is new since this plan". */
export function brainEvidenceSinceQuery(
  workspaceId: string,
  since: Date,
  limit = 100,
) {
  return db
    .select({
      id: platinaBrainChunks.id,
      content: platinaBrainChunks.content,
      confidence: platinaBrainChunks.confidence,
      sourceSignalIds: platinaBrainChunks.sourceSignalIds,
      createdAt: platinaBrainChunks.createdAt,
    })
    .from(platinaBrainChunks)
    .where(
      and(
        eq(platinaBrainChunks.workspaceId, workspaceId),
        eq(platinaBrainChunks.status, "active"),
        gte(platinaBrainChunks.createdAt, since),
      ),
    )
    .orderBy(desc(platinaBrainChunks.createdAt))
    .limit(limit);
}

export async function listBrainEvidenceSince(
  workspaceId: string,
  since: Date,
  limit = 100,
) {
  return brainEvidenceSinceQuery(workspaceId, since, limit);
}

/** Provider attempts that failed for this workspace's AI calls — the ladder swapping. */
export function providerFailuresSinceQuery(workspaceId: string, since: Date) {
  return db
    .select({
      provider: aiUsage.provider,
      model: aiUsage.model,
      failures: count(),
      lastError: max(aiUsage.error),
    })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.workspaceId, workspaceId),
        eq(aiUsage.status, "failed"),
        gte(aiUsage.createdAt, since),
      ),
    )
    .groupBy(aiUsage.provider, aiUsage.model);
}

export async function listProviderFailuresSince(workspaceId: string, since: Date) {
  return providerFailuresSinceQuery(workspaceId, since);
}

/** Which client a finding is about: finding -> signal -> source -> brand. */
export function findingBrandQuery(workspaceId: string, findingId: string) {
  return db
    .select({ brandId: platinaScanSpecs.brandId })
    .from(platinaFindings)
    .innerJoin(
      platinaSignalDocuments,
      eq(platinaFindings.signalDocumentId, platinaSignalDocuments.id),
    )
    .innerJoin(
      platinaScanSpecs,
      eq(platinaSignalDocuments.scanSpecId, platinaScanSpecs.id),
    )
    .where(
      and(
        eq(platinaFindings.workspaceId, workspaceId),
        eq(platinaSignalDocuments.workspaceId, workspaceId),
        eq(platinaScanSpecs.workspaceId, workspaceId),
        eq(platinaFindings.id, findingId),
      ),
    )
    .limit(1);
}

/**
 * The client (own brand) a finding belongs to. A competitor's finding resolves
 * to the client that competitor was added for. Null when the source has no brand.
 */
export async function getClientForFinding(workspaceId: string, findingId: string) {
  const brandId = (await findingBrandQuery(workspaceId, findingId))[0]?.brandId;
  if (!brandId) return null;
  const brand = await getBrand(workspaceId, brandId);
  if (!brand) return null;
  if (brand.kind === "own_brand") return brand;
  return brand.parentBrandId ? getBrand(workspaceId, brand.parentBrandId) : null;
}

/** Plans that revise this one (newest first) — the "newer version" link. */
export function planRevisionsQuery(workspaceId: string, planId: string) {
  return db
    .select({ id: platinaPlans.id, title: platinaPlans.title, createdAt: platinaPlans.createdAt })
    .from(platinaPlans)
    .where(
      and(
        eq(platinaPlans.workspaceId, workspaceId),
        eq(platinaPlans.parentPlanId, planId),
      ),
    )
    .orderBy(desc(platinaPlans.createdAt));
}

export async function listPlanRevisions(workspaceId: string, planId: string) {
  return planRevisionsQuery(workspaceId, planId);
}

// ---------------------------------------------------------------------------
// Client profile + first-run robustness
// ---------------------------------------------------------------------------

/** A client's OWN scraped pages (not its competitors'), newest first. */
export function ownPagesQuery(workspaceId: string, brandId: string, limit = 40) {
  return db
    .select({
      url: platinaSignalDocuments.sourceUrl,
      canonicalUrl: platinaSignalDocuments.canonicalUrl,
      kind: platinaSignalDocuments.sourceKind,
      title: platinaSignalDocuments.title,
      body: sql<string>`left(${platinaSignalDocuments.body}, 2500)`,
      fetchedAt: platinaSignalDocuments.fetchedAt,
    })
    .from(platinaSignalDocuments)
    .innerJoin(
      platinaScanSpecs,
      eq(platinaSignalDocuments.scanSpecId, platinaScanSpecs.id),
    )
    .where(
      and(
        eq(platinaSignalDocuments.workspaceId, workspaceId),
        eq(platinaScanSpecs.workspaceId, workspaceId),
        eq(platinaScanSpecs.brandId, brandId),
      ),
    )
    .orderBy(desc(platinaSignalDocuments.fetchedAt))
    .limit(limit);
}

export async function listOwnPages(workspaceId: string, brandId: string, limit = 40) {
  return ownPagesQuery(workspaceId, brandId, limit);
}

export async function saveBrandProfile(
  workspaceId: string,
  brandId: string,
  input: { profile: ClientProfile; sources: string[] },
) {
  await db
    .update(platinaBrands)
    .set({
      profile: input.profile,
      profileSources: input.sources,
      profileUpdatedAt: new Date(),
      profileError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(platinaBrands.workspaceId, workspaceId),
        eq(platinaBrands.id, brandId),
        eq(platinaBrands.kind, "own_brand"),
      ),
    );
}

/** A failed analysis stays visible on the client page instead of an empty card. */
export async function saveBrandProfileError(
  workspaceId: string,
  brandId: string,
  message: string,
) {
  await db
    .update(platinaBrands)
    .set({ profileError: message.slice(0, 300), updatedAt: new Date() })
    .where(
      and(
        eq(platinaBrands.workspaceId, workspaceId),
        eq(platinaBrands.id, brandId),
      ),
    );
}

/**
 * Runs that were created but never picked up (the job runner was down when
 * they were requested). Cross-workspace by design, like listSchedulableSpecs:
 * a background sweep — every row carries its own workspace_id.
 */
export async function listStaleQueuedRuns(olderThan: Date, limit = 50) {
  return db
    .select({ id: platinaAuditRuns.id, workspaceId: platinaAuditRuns.workspaceId })
    .from(platinaAuditRuns)
    .where(
      and(
        eq(platinaAuditRuns.status, "queued"),
        lte(platinaAuditRuns.queuedAt, olderThan),
      ),
    )
    .orderBy(platinaAuditRuns.queuedAt)
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Interest signals (campaign intelligence C3)
// ---------------------------------------------------------------------------

/**
 * Social posts and ads collected for a client and its competitors since a
 * date — the raw material for interest and pressure signals. Scoped by
 * workspace on BOTH the documents and the specs they came from.
 */
export function interestSourceDocsQuery(
  workspaceId: string,
  brandIds: string[],
  since: Date,
) {
  return db
    .select({
      id: platinaSignalDocuments.id,
      brandId: platinaScanSpecs.brandId,
      sourceKind: platinaSignalDocuments.sourceKind,
      sourceUrl: platinaSignalDocuments.sourceUrl,
      canonicalUrl: platinaSignalDocuments.canonicalUrl,
      body: platinaSignalDocuments.body,
      metrics: platinaSignalDocuments.metrics,
      raw: platinaSignalDocuments.raw,
      fetchedAt: platinaSignalDocuments.fetchedAt,
    })
    .from(platinaSignalDocuments)
    .innerJoin(platinaScanSpecs, eq(platinaScanSpecs.id, platinaSignalDocuments.scanSpecId))
    .where(
      and(
        eq(platinaSignalDocuments.workspaceId, workspaceId),
        eq(platinaScanSpecs.workspaceId, workspaceId),
        inArray(platinaScanSpecs.brandId, brandIds.length > 0 ? brandIds : ["__none__"]),
        inArray(platinaSignalDocuments.sourceKind, ["social_posts", "ad_library"]),
        gte(platinaSignalDocuments.fetchedAt, since),
      ),
    );
}

export async function listInterestSourceDocs(workspaceId: string, brandIds: string[], since: Date) {
  return interestSourceDocsQuery(workspaceId, brandIds, since);
}

/** Idempotent: re-measuring the same post on the same day is a no-op. */
export async function insertInterestSignals(
  rows: (typeof platinaInterestSignals.$inferInsert)[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(platinaInterestSignals)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: platinaInterestSignals.id });
  return inserted.length;
}

export function interestSignalsQuery(workspaceId: string, brandIds: string[], since: Date) {
  return db
    .select()
    .from(platinaInterestSignals)
    .where(
      and(
        eq(platinaInterestSignals.workspaceId, workspaceId),
        inArray(platinaInterestSignals.brandId, brandIds.length > 0 ? brandIds : ["__none__"]),
        gte(platinaInterestSignals.observedAt, since),
      ),
    );
}

export async function listInterestSignals(workspaceId: string, brandIds: string[], since: Date) {
  return interestSignalsQuery(workspaceId, brandIds, since);
}

// ---------------------------------------------------------------------------
// Events (campaign intelligence C4)
// ---------------------------------------------------------------------------

/**
 * Documents events are read from: conference pages (any spec) and social
 * posts (a company announcing where it will be). Scoped by workspace on the
 * documents AND, for the spec join, on the specs.
 */
export function eventSourceDocsQuery(workspaceId: string, since: Date) {
  return db
    .select({
      id: platinaSignalDocuments.id,
      brandId: platinaScanSpecs.brandId,
      sourceKind: platinaSignalDocuments.sourceKind,
      sourceUrl: platinaSignalDocuments.sourceUrl,
      canonicalUrl: platinaSignalDocuments.canonicalUrl,
      title: platinaSignalDocuments.title,
      body: platinaSignalDocuments.body,
      metrics: platinaSignalDocuments.metrics,
      fetchedAt: platinaSignalDocuments.fetchedAt,
    })
    .from(platinaSignalDocuments)
    .leftJoin(
      platinaScanSpecs,
      and(
        eq(platinaScanSpecs.id, platinaSignalDocuments.scanSpecId),
        eq(platinaScanSpecs.workspaceId, workspaceId),
      ),
    )
    .where(
      and(
        eq(platinaSignalDocuments.workspaceId, workspaceId),
        inArray(platinaSignalDocuments.sourceKind, ["conference", "social_posts"]),
        gte(platinaSignalDocuments.fetchedAt, since),
      ),
    );
}

export async function listEventSourceDocs(workspaceId: string, since: Date) {
  return eventSourceDocsQuery(workspaceId, since);
}

export function eventsQuery(workspaceId: string) {
  return db
    .select()
    .from(platinaEvents)
    .where(eq(platinaEvents.workspaceId, workspaceId))
    .orderBy(platinaEvents.startsOn);
}

export async function listEvents(workspaceId: string) {
  return eventsQuery(workspaceId);
}

/**
 * Insert an event, or refresh the one with the same key: a later sighting
 * fills what an earlier one lacked (a post without dates, then the event
 * page), but never overwrites a date already read.
 */
export async function upsertEvent(input: typeof platinaEvents.$inferInsert): Promise<string> {
  const [row] = await db
    .insert(platinaEvents)
    .values(input)
    .onConflictDoUpdate({
      target: [platinaEvents.workspaceId, platinaEvents.eventKey],
      set: {
        lastSeenAt: sql`now()`,
        startsOn: sql`coalesce(${platinaEvents.startsOn}, excluded.starts_on)`,
        endsOn: sql`coalesce(${platinaEvents.endsOn}, excluded.ends_on)`,
        dateText: sql`coalesce(${platinaEvents.dateText}, excluded.date_text)`,
        location: sql`coalesce(${platinaEvents.location}, excluded.location)`,
        country: sql`coalesce(${platinaEvents.country}, excluded.country)`,
        // A newer read of the event page replaces the older one's notes.
        detail: sql`coalesce(excluded.detail, ${platinaEvents.detail})`,
      },
      // The conflict target already pins the workspace; this keeps it explicit.
      setWhere: eq(platinaEvents.workspaceId, input.workspaceId),
    })
    .returning({ id: platinaEvents.id });
  return row.id;
}

export async function insertEventParticipants(
  rows: (typeof platinaEventParticipants.$inferInsert)[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(platinaEventParticipants)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: platinaEventParticipants.id });
  return inserted.length;
}

export function eventParticipantsQuery(workspaceId: string, eventIds: string[]) {
  return db
    .select()
    .from(platinaEventParticipants)
    .where(
      and(
        eq(platinaEventParticipants.workspaceId, workspaceId),
        inArray(platinaEventParticipants.eventId, eventIds.length > 0 ? eventIds : ["__none__"]),
      ),
    );
}

export async function listEventParticipants(workspaceId: string, eventIds: string[]) {
  return eventParticipantsQuery(workspaceId, eventIds);
}

// ---------------------------------------------------------------------------
// Measured market insights in the Brain (C5)
// ---------------------------------------------------------------------------

/** Active insight chunks whose key starts with `prefix` ("interest:<clientId>:", "event:"). */
export function activeInsightChunksQuery(workspaceId: string, prefix: string) {
  return db
    .select({
      id: platinaBrainChunks.id,
      insightKey: platinaBrainChunks.insightKey,
      content: platinaBrainChunks.content,
    })
    .from(platinaBrainChunks)
    .where(
      and(
        eq(platinaBrainChunks.workspaceId, workspaceId),
        eq(platinaBrainChunks.status, "active"),
        sql`${platinaBrainChunks.insightKey} like ${prefix.replace(/[%_\\]/g, "\\$&") + "%"}`,
      ),
    );
}

export async function listActiveInsightChunks(workspaceId: string, prefix: string) {
  return activeInsightChunksQuery(workspaceId, prefix);
}

/** Retire replaced measurements. Kept for history; retrieval reads active only. */
export async function supersedeBrainChunks(workspaceId: string, ids: string[]) {
  if (ids.length === 0) return;
  await db
    .update(platinaBrainChunks)
    .set({ status: "superseded" })
    .where(and(eq(platinaBrainChunks.workspaceId, workspaceId), inArray(platinaBrainChunks.id, ids)));
}

/**
 * Documents from workspace-wide sources (no client attached: event pages,
 * trade press added for the whole workspace). A workspace is one division ×
 * region, so these are market context for every client in it.
 */
export function workspaceWideSignalIdsQuery(workspaceId: string, limit = 2000) {
  return db
    .select({ id: platinaSignalDocuments.id })
    .from(platinaSignalDocuments)
    .innerJoin(platinaScanSpecs, eq(platinaSignalDocuments.scanSpecId, platinaScanSpecs.id))
    .where(
      and(
        eq(platinaSignalDocuments.workspaceId, workspaceId),
        eq(platinaScanSpecs.workspaceId, workspaceId),
        isNull(platinaScanSpecs.brandId),
      ),
    )
    .orderBy(desc(platinaSignalDocuments.fetchedAt))
    .limit(limit);
}

export async function listWorkspaceWideSignalIds(workspaceId: string) {
  return (await workspaceWideSignalIdsQuery(workspaceId)).map((r) => r.id);
}
