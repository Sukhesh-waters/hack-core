import { and, cosineDistance, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  platinaAlertRules,
  platinaAuditRunEvents,
  platinaAuditRuns,
  platinaBrandChunks,
  platinaBrainChunks,
  platinaCampaigns,
  platinaDebateTranscripts,
  platinaFindings,
  platinaGateEvents,
  platinaOutcomes,
  platinaReceipts,
  platinaScanSpecs,
  platinaSignalDocuments,
  platinaSolutionTasks,
  platinaWorkspaceConfig,
  platinaWorkspaceProfiles,
  PLATINA_EMBEDDING_MODEL_VERSION,
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
    .where(eq(platinaBrandChunks.workspaceId, workspaceId))
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

export async function insertBrandChunk(input: {
  workspaceId: string;
  content: string;
  sourceUrl?: string;
  title?: string;
  embedding?: number[];
  chunkIndex?: number;
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
}) {
  const [row] = await db
    .insert(platinaOutcomes)
    .values(input)
    .returning({ id: platinaOutcomes.id });
  return row.id;
}

export async function demoteBrainChunk(workspaceId: string, chunkId: string) {
  await db
    .update(platinaBrainChunks)
    .set({ status: "demoted" })
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

export function unprocessedSignalsQuery(workspaceId: string) {
  return db
    .select()
    .from(platinaSignalDocuments)
    .where(
      and(
        eq(platinaSignalDocuments.workspaceId, workspaceId),
        eq(platinaSignalDocuments.processingState, "unprocessed"),
      ),
    )
    .orderBy(desc(platinaSignalDocuments.createdAt))
    .limit(20);
}

export async function listUnresolvedSignals(workspaceId: string) {
  return unprocessedSignalsQuery(workspaceId);
}

/** Mark a signal's contradiction round complete — the sweep never re-reads it. */
export async function markSignalProcessed(workspaceId: string, signalId: string) {
  await db
    .update(platinaSignalDocuments)
    .set({ processingState: "processed" })
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
  outcome: { inserted: number; failed: boolean },
  intervals: {
    tighten: (current: number | null, floor: number) => number;
    backoff: (current: number | null) => number;
  },
) {
  const spec = await getScanSpec(workspaceId, specId);
  if (!spec) return;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const fetchesToday = spec.fetchesDay === today ? spec.fetchesToday + 1 : 1;
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

export { sql };
