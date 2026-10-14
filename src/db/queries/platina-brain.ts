/**
 * Brain telemetry, the undo journal, and per-stage modes (B0 — metacognitive
 * Brain). Every query filters workspace_id explicitly (app-layer isolation;
 * see CLAUDE.md) and platina-brain.test.ts asserts it in the generated SQL,
 * following the house pattern in platina-learning.ts.
 *
 * `setBrainState` is the ONE way a new stage may change a Brain chunk's
 * status, confidence or agreement_state (plan §11.2): it writes the change
 * and its undo-journal row in a single transaction. No other export here
 * updates those three columns.
 */
import { and, asc, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  platinaBrainChunks,
  platinaBrainStateLog,
  platinaBrainTelemetry,
  platinaWorkspaceConfig,
  type BrainChunkGradeState,
  type BrainSkipCause,
} from "@/db/platina-schema";
import {
  BRAIN_STAGES,
  parseBrainModes,
  type BrainMode,
  type BrainModes,
  type BrainStage,
} from "@/lib/platina/brain-modes";
import {
  diffBrainState,
  refutedByGradeIdPatch,
  type BrainState,
  type BrainStateDiffRow,
  type BrainStateField,
} from "@/lib/platina/brain-state";

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

export type InsertBrainTelemetryInput = {
  workspaceId: string;
  stage: BrainStage | "analysis";
  decision: string;
  subjectId?: string | null;
  detail?: Record<string, unknown> | null;
  promptVersion?: string | null;
};

/** One funnel event. Append-only: no update/delete is exported for this table. */
export async function insertBrainTelemetry(input: InsertBrainTelemetryInput): Promise<string> {
  const [row] = await db
    .insert(platinaBrainTelemetry)
    .values({
      workspaceId: input.workspaceId,
      stage: input.stage,
      decision: input.decision,
      subjectId: input.subjectId ?? null,
      detail: input.detail ?? null,
      promptVersion: input.promptVersion ?? null,
    })
    .returning({ id: platinaBrainTelemetry.id });
  return row.id;
}

export type BrainTelemetryFilter = { stage?: BrainStage | "analysis"; since?: Date };

/** Raw telemetry rows, newest first. */
export function brainTelemetryQuery(workspaceId: string, filter: BrainTelemetryFilter = {}) {
  return db
    .select()
    .from(platinaBrainTelemetry)
    .where(
      and(
        eq(platinaBrainTelemetry.workspaceId, workspaceId),
        ...(filter.stage ? [eq(platinaBrainTelemetry.stage, filter.stage)] : []),
        ...(filter.since ? [gte(platinaBrainTelemetry.createdAt, filter.since)] : []),
      ),
    )
    .orderBy(desc(platinaBrainTelemetry.createdAt));
}

export async function listBrainTelemetry(workspaceId: string, filter: BrainTelemetryFilter = {}) {
  return brainTelemetryQuery(workspaceId, filter);
}

/** Counts per (stage, decision) since a moment — the raw input to `summariseFunnel`. */
export function brainFunnelCountsQuery(workspaceId: string, since: Date) {
  return db
    .select({
      stage: platinaBrainTelemetry.stage,
      decision: platinaBrainTelemetry.decision,
      count: sql<number>`count(*)::int`,
    })
    .from(platinaBrainTelemetry)
    .where(and(eq(platinaBrainTelemetry.workspaceId, workspaceId), gte(platinaBrainTelemetry.createdAt, since)))
    .groupBy(platinaBrainTelemetry.stage, platinaBrainTelemetry.decision);
}

export async function brainFunnelCounts(workspaceId: string, since: Date) {
  return brainFunnelCountsQuery(workspaceId, since);
}

/** Deletes telemetry rows older than `before` (the 120-day retention, plan §4). */
export function pruneBrainTelemetryQuery(workspaceId: string, before: Date) {
  return db
    .delete(platinaBrainTelemetry)
    .where(and(eq(platinaBrainTelemetry.workspaceId, workspaceId), lt(platinaBrainTelemetry.createdAt, before)));
}

export async function pruneBrainTelemetry(workspaceId: string, before: Date): Promise<void> {
  await pruneBrainTelemetryQuery(workspaceId, before);
}

// ---------------------------------------------------------------------------
// Undo journal
// ---------------------------------------------------------------------------

export type InsertBrainStateLogInput = {
  workspaceId: string;
  brainChunkId: string;
  field: BrainStateField;
  fromValue: string | number | null;
  toValue: string | number | null;
  cause: string;
  gradeId?: string | null;
};

/** One undo-journal row. Append-only: no update/delete is exported for this table. */
export async function insertBrainStateLog(input: InsertBrainStateLogInput): Promise<string> {
  const [row] = await db
    .insert(platinaBrainStateLog)
    .values({
      workspaceId: input.workspaceId,
      brainChunkId: input.brainChunkId,
      field: input.field,
      fromValue: input.fromValue,
      toValue: input.toValue,
      cause: input.cause,
      gradeId: input.gradeId ?? null,
    })
    .returning({ id: platinaBrainStateLog.id });
  return row.id;
}

export type BrainStateLogFilter = { cause?: string; since?: Date; chunkIds?: string[] };

export function brainStateLogQuery(workspaceId: string, filter: BrainStateLogFilter = {}) {
  return db
    .select()
    .from(platinaBrainStateLog)
    .where(
      and(
        eq(platinaBrainStateLog.workspaceId, workspaceId),
        ...(filter.cause ? [eq(platinaBrainStateLog.cause, filter.cause)] : []),
        ...(filter.since ? [gte(platinaBrainStateLog.createdAt, filter.since)] : []),
        ...(filter.chunkIds && filter.chunkIds.length > 0
          ? [inArray(platinaBrainStateLog.brainChunkId, filter.chunkIds)]
          : []),
      ),
    )
    .orderBy(asc(platinaBrainStateLog.createdAt));
}

export async function listBrainStateLog(workspaceId: string, filter: BrainStateLogFilter = {}) {
  return brainStateLogQuery(workspaceId, filter);
}

// ---------------------------------------------------------------------------
// Modes (platina_workspace_config.brain_modes)
// ---------------------------------------------------------------------------

/** A complete, validated mode map (missing/invalid -> "off"). Reads with no config row as all-off. */
export async function getBrainModes(workspaceId: string): Promise<Record<BrainStage, BrainMode>> {
  const [row] = await db
    .select({ brainModes: platinaWorkspaceConfig.brainModes })
    .from(platinaWorkspaceConfig)
    .where(eq(platinaWorkspaceConfig.workspaceId, workspaceId))
    .limit(1);
  return parseBrainModes(row?.brainModes ?? null);
}

/** Merges `modes` onto whatever is stored (never clears a stage this call does not mention). */
export async function setBrainModes(workspaceId: string, modes: BrainModes): Promise<void> {
  const [existing] = await db
    .select({ id: platinaWorkspaceConfig.id, brainModes: platinaWorkspaceConfig.brainModes })
    .from(platinaWorkspaceConfig)
    .where(eq(platinaWorkspaceConfig.workspaceId, workspaceId))
    .limit(1);
  const merged: BrainModes = { ...(existing?.brainModes ?? {}), ...modes };
  if (existing) {
    await db
      .update(platinaWorkspaceConfig)
      .set({ brainModes: merged, updatedAt: new Date() })
      .where(eq(platinaWorkspaceConfig.workspaceId, workspaceId));
    return;
  }
  await db.insert(platinaWorkspaceConfig).values({ workspaceId, brainModes: merged });
}

// Re-exported so a caller only needs this module to read the stage list.
export { BRAIN_STAGES };

export type BrainConfigPatch = Partial<{
  surpriseFloor: number;
  surpriseAuditShare: number;
  derivedContextShare: number;
}>;

/**
 * Restores the surprise-filter floor/audit-share and derived-context-share
 * knobs (plan §11.4, snapshot `--restore`). Not a Brain-chunk state change —
 * these are workspace-level knobs, not status/confidence/agreement_state, so
 * they are not logged through `setBrainState`'s undo journal.
 */
export async function setBrainConfig(workspaceId: string, patch: BrainConfigPatch): Promise<void> {
  const [existing] = await db
    .select({ id: platinaWorkspaceConfig.id })
    .from(platinaWorkspaceConfig)
    .where(eq(platinaWorkspaceConfig.workspaceId, workspaceId))
    .limit(1);
  if (existing) {
    await db
      .update(platinaWorkspaceConfig)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(platinaWorkspaceConfig.workspaceId, workspaceId));
    return;
  }
  await db.insert(platinaWorkspaceConfig).values({ workspaceId, ...patch });
}

// ---------------------------------------------------------------------------
// setBrainState — the only writer of Brain chunk status/confidence/agreement_state
// ---------------------------------------------------------------------------

type BrainChunkStatus = "active" | "demoted" | "superseded" | "archived";
type BrainChunkAgreementState = "agreed" | "qualified" | "contested" | "refuted";
type BrainChunkStatePatch = Partial<{
  status: BrainChunkStatus;
  confidence: number;
  agreementState: BrainChunkAgreementState;
  gradeState: BrainChunkGradeState;
  // Not a diffed/undoable BrainStateField (see brain-state.ts
  // refutedByGradeIdPatch) — set alongside gradeState -> "refuted" in the
  // same write, never on its own.
  refutedByGradeId: string;
}>;

/** Shared so the tested builders below and `setBrainState`'s transaction never drift apart. */
function chunkFilter(workspaceId: string, chunkId: string): SQL {
  return and(eq(platinaBrainChunks.workspaceId, workspaceId), eq(platinaBrainChunks.id, chunkId))!;
}

/**
 * The current state `setBrainState` diffs against. Exported so its SQL shape
 * is testable. `FOR UPDATE`-locked: `setBrainState` runs this inside its
 * transaction, so a concurrent grader/undo/restore reading the same chunk
 * blocks behind this one instead of both diffing the same stale row and one
 * writer's change being silently lost.
 */
export function brainChunkStateQuery(workspaceId: string, chunkId: string, executor: Pick<typeof db, "select"> = db) {
  return executor
    .select({
      status: platinaBrainChunks.status,
      confidence: platinaBrainChunks.confidence,
      agreementState: platinaBrainChunks.agreementState,
      gradeState: platinaBrainChunks.gradeState,
    })
    .from(platinaBrainChunks)
    .where(chunkFilter(workspaceId, chunkId))
    .limit(1)
    .for("update");
}

/** The write `setBrainState` issues after diffing. Exported so its SQL shape is testable. */
export function updateBrainChunkStateQuery(workspaceId: string, chunkId: string, patch: BrainChunkStatePatch) {
  return db.update(platinaBrainChunks).set(patch).where(chunkFilter(workspaceId, chunkId));
}

function toPatch(diff: BrainStateDiffRow[]): BrainChunkStatePatch {
  const patch: BrainChunkStatePatch = {};
  for (const row of diff) {
    if (row.field === "status") patch.status = row.toValue as BrainChunkStatus;
    else if (row.field === "confidence") patch.confidence = row.toValue as number;
    else if (row.field === "agreementState") patch.agreementState = row.toValue as BrainChunkAgreementState;
    else if (row.field === "gradeState") patch.gradeState = row.toValue as BrainChunkGradeState;
  }
  return patch;
}

/**
 * Applies `next` to a Brain chunk's status/confidence/agreement_state/
 * grade_state, but only the fields that actually change, and logs each
 * change in platina_brain_state_log in the same transaction. When a change
 * moves grade_state to "refuted" and `gradeId` is given, refuted_by_grade_id
 * is set in the same write (brain-state.ts refutedByGradeIdPatch) — it is
 * not itself a diffed/journaled field. A chunk outside this workspace, or
 * not found, changes nothing and returns []. `cause` is the stage +
 * prompt_version or script name that made the change (e.g. "grading",
 * "undo:<run id>").
 */
export async function setBrainState(
  workspaceId: string,
  chunkId: string,
  next: BrainState,
  cause: string,
  gradeId?: string | null,
): Promise<BrainStateDiffRow[]> {
  return db.transaction(async (tx) => {
    const [current] = await brainChunkStateQuery(workspaceId, chunkId, tx);
    if (!current) return [];

    const diff = diffBrainState(current, next);
    if (diff.length === 0) return [];

    const patch: BrainChunkStatePatch = { ...toPatch(diff), ...refutedByGradeIdPatch(diff, gradeId) };
    await tx.update(platinaBrainChunks).set(patch).where(chunkFilter(workspaceId, chunkId));

    await tx.insert(platinaBrainStateLog).values(
      diff.map((row) => ({
        workspaceId,
        brainChunkId: chunkId,
        field: row.field,
        fromValue: row.fromValue,
        toValue: row.toValue,
        cause,
        gradeId: gradeId ?? null,
      })),
    );

    return diff;
  });
}

export type { BrainSkipCause };
