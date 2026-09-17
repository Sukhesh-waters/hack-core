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
  platinaGateEvents,
  platinaOutcomes,
  platinaReceipts,
  platinaScanSpecs,
  platinaSignalDocuments,
  platinaWorkspaceConfig,
  platinaWorkspaceProfiles,
  type PlatinaRunConfigSnapshot,
  type PlatinaScanTarget,
} from "@/db/platina-schema";
import type { GateWrite } from "@/lib/platina/gates";
import type { RawSignalDoc } from "@/lib/platina/fetch/registry";
import type { RunStatus } from "@/lib/platina/run-status";

export function similarBrandChunksQuery(
  workspaceId: string,
  embedding: number[],
  limit = 8,
) {
  return db
    .select({
      id: platinaBrandChunks.id,
      content: platinaBrandChunks.content,
    })
    .from(platinaBrandChunks)
    .where(eq(platinaBrandChunks.workspaceId, workspaceId))
    .orderBy(cosineDistance(platinaBrandChunks.embedding, embedding))
    .limit(limit);
}

export function similarBrainChunksQuery(
  workspaceId: string,
  embedding: number[],
  limit = 6,
) {
  return db
    .select({
      id: platinaBrainChunks.id,
      content: platinaBrainChunks.content,
      confidence: platinaBrainChunks.confidence,
      generation: platinaBrainChunks.generation,
    })
    .from(platinaBrainChunks)
    .where(
      and(
        eq(platinaBrainChunks.workspaceId, workspaceId),
        eq(platinaBrainChunks.status, "active"),
      ),
    )
    .orderBy(cosineDistance(platinaBrainChunks.embedding, embedding))
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
}) {
  const [row] = await db
    .insert(platinaCampaigns)
    .values(input)
    .returning({ id: platinaCampaigns.id });
  return row.id;
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

export async function listUnresolvedSignals(workspaceId: string) {
  return db
    .select()
    .from(platinaSignalDocuments)
    .where(eq(platinaSignalDocuments.workspaceId, workspaceId))
    .orderBy(desc(platinaSignalDocuments.createdAt))
    .limit(20);
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

export { sql };
