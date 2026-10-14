/**
 * Falsifier grade queries (B5 — metacognitive Brain). Every query filters
 * workspace_id explicitly (app-layer isolation; see CLAUDE.md) and
 * platina-grades.test.ts asserts it in the generated SQL, following the
 * house pattern in platina-brain.ts / platina-learning.ts.
 *
 * `platina_insight_grades` is append-only: no update/delete query is
 * exported here, matching platina_brain_telemetry and platina_brain_state_log.
 */
import { and, asc, cosineDistance, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  PLATINA_EMBEDDING_MODEL_VERSION,
  platinaBrainChunks,
  platinaInsightGrades,
  type BrainChunkGradeState,
  type InsightGradeVerdict,
} from "@/db/platina-schema";
import type { FalsifierClaim, Plane } from "@/lib/platina/falsifier-metrics";

// ---------------------------------------------------------------------------
// Due chunks — the daily grader's read path
// ---------------------------------------------------------------------------

/** Only these two kinds ever carry a falsifier (B1 analysis-writes.ts, market-insight-writer.ts). Facts and legacy rows are excluded structurally by `falsifier is not null` below, not by this list alone. */
const GRADABLE_KINDS = ["claim", "measured"] as const;
/**
 * Insufficient is terminal and NOT re-queried (plan §5 B5 names only
 * untested|holding) — reached two ways: a chunk whose interrogation itself
 * failed validation gets gradeState="insufficient" at write time and is
 * never graded at all (analysis-writes.ts), or a chunk that keeps measuring
 * "not enough data" stays untested/holding (still due) through
 * MAX_INSUFFICIENT_ATTEMPTS grading attempts before the grader itself sets
 * it terminal (falsifier-grade.ts insufficientAttemptsExhausted).
 */
const DUE_GRADE_STATES: BrainChunkGradeState[] = ["untested", "holding"];

export type DueFalsifierChunk = {
  id: string;
  falsifier: FalsifierClaim;
  subjectKey: string | null;
  dueAt: Date;
  gradeState: BrainChunkGradeState;
};

/**
 * One page of chunks whose falsifier window has closed and is still
 * eligible to be tested: `kind` in (claim, measured), a validated falsifier,
 * `grade_state` untested or holding, `due_at` <= now, `status` active.
 * Cursor-paginated by id (not offset): the due set shrinks as the caller
 * grades rows (their grade_state leaves untested|holding), so an offset
 * would skip or repeat rows across pages; `id > afterId` cannot. One
 * `step.run` per page in the Inngest handler, so a crash resumes at the next
 * page (plan §12 "pages of 200, one step.run per page").
 */
export function dueFalsifierChunksQuery(
  workspaceId: string,
  now: Date,
  options: { limit?: number; afterId?: string } = {},
) {
  return db
    .select({
      id: platinaBrainChunks.id,
      falsifier: platinaBrainChunks.falsifier,
      subjectKey: platinaBrainChunks.subjectKey,
      dueAt: platinaBrainChunks.dueAt,
      gradeState: platinaBrainChunks.gradeState,
    })
    .from(platinaBrainChunks)
    .where(
      and(
        eq(platinaBrainChunks.workspaceId, workspaceId),
        inArray(platinaBrainChunks.kind, GRADABLE_KINDS),
        sql`${platinaBrainChunks.falsifier} is not null`,
        inArray(platinaBrainChunks.gradeState, DUE_GRADE_STATES),
        lte(platinaBrainChunks.dueAt, now),
        eq(platinaBrainChunks.status, "active"),
        ...(options.afterId ? [gt(platinaBrainChunks.id, options.afterId)] : []),
      ),
    )
    .orderBy(asc(platinaBrainChunks.id))
    .limit(options.limit ?? 200);
}

export async function listDueFalsifierChunks(
  workspaceId: string,
  now: Date,
  options: { limit?: number; afterId?: string } = {},
): Promise<DueFalsifierChunk[]> {
  const rows = await dueFalsifierChunksQuery(workspaceId, now, options);
  // falsifier/dueAt are non-null by construction of the WHERE clause above;
  // Drizzle's jsonb/timestamp columns are nullable in the type only because
  // most other chunk kinds leave them null.
  return rows
    .filter((r): r is DueFalsifierChunk & { falsifier: FalsifierClaim; dueAt: Date } => r.falsifier !== null && r.dueAt !== null)
    .map((r) => ({ ...r, falsifier: r.falsifier as FalsifierClaim, dueAt: r.dueAt as Date }));
}

// ---------------------------------------------------------------------------
// Writing a grade — once per (chunk, metric, window, due date)
// ---------------------------------------------------------------------------

export type InsertGradeInput = {
  workspaceId: string;
  brainChunkId: string;
  metric: string;
  scaleVersion: number;
  windowDays: number;
  /** The chunk's due_at THIS grade tested — part of the unique key (see platina-schema.ts platinaInsightGrades comment). */
  dueAt: Date;
  threshold: number;
  direction: "above" | "below";
  measuredValue: number | null;
  n: number;
  verdict: InsightGradeVerdict;
  plane: Plane;
};

/**
 * Idempotent per (brain_chunk_id, metric, window_days, due_at) — ON
 * CONFLICT DO NOTHING on exactly that unique key, so a crash-replay of the
 * same page (plan §12) never writes a second grade for the SAME due date,
 * and a shadow-mode chunk (whose due_at never advances — see
 * advanceDueAtQuery) writes exactly one row no matter how many days the
 * daily sweep re-measures it. `inserted: false` on a conflict means "this
 * exact due date was already graded"; the caller skips any further state
 * change or due_at push rather than re-deciding it.
 */
export async function insertGrade(input: InsertGradeInput): Promise<{ id: string; inserted: boolean }> {
  const [row] = await db.insert(platinaInsightGrades).values(input).onConflictDoNothing().returning({ id: platinaInsightGrades.id });
  if (row) return { id: row.id, inserted: true };
  const [existing] = await db
    .select({ id: platinaInsightGrades.id })
    .from(platinaInsightGrades)
    .where(
      and(
        eq(platinaInsightGrades.brainChunkId, input.brainChunkId),
        eq(platinaInsightGrades.metric, input.metric),
        eq(platinaInsightGrades.windowDays, input.windowDays),
        eq(platinaInsightGrades.dueAt, input.dueAt),
      ),
    )
    .limit(1);
  return { id: existing.id, inserted: false };
}

// ---------------------------------------------------------------------------
// Advancing a chunk's due_at — the re-test schedule, not journaled state
// ---------------------------------------------------------------------------

/**
 * Pushes a chunk's due_at forward (holding/insufficient, plan §5 B5 "it is
 * re-measured next window"). This is a plain, workspace-filtered update, NOT
 * through setBrainState: due_at is a schedule, not one of the four
 * journaled state fields (status/confidence/agreementState/gradeState), so
 * undoing a grading run never needs to "undo" a due date.
 *
 * Guarded on `fromDueAt` still being the chunk's current due_at: on a
 * crash-replay where the grade insert conflicted (already graded for that
 * due date) but an EARLIER attempt already advanced due_at, this WHERE
 * clause matches nothing and the call is a safe no-op — due_at can only
 * ever be pushed forward once per grade.
 */
export function advanceDueAtQuery(workspaceId: string, chunkId: string, fromDueAt: Date, toDueAt: Date) {
  return db
    .update(platinaBrainChunks)
    .set({ dueAt: toDueAt })
    .where(
      and(
        eq(platinaBrainChunks.workspaceId, workspaceId),
        eq(platinaBrainChunks.id, chunkId),
        eq(platinaBrainChunks.dueAt, fromDueAt),
      ),
    );
}

export async function advanceDueAt(workspaceId: string, chunkId: string, fromDueAt: Date, toDueAt: Date): Promise<void> {
  await advanceDueAtQuery(workspaceId, chunkId, fromDueAt, toDueAt);
}

// ---------------------------------------------------------------------------
// Refuted chunks by subject — B6's counter-evidence slot
// ---------------------------------------------------------------------------

/**
 * Refuted, demoted chunks on the same subject (B6's disconfirming slot picks
 * the most relevant one, or falls back to this when no opposite-direction
 * active chunk exists — plan §5 B6). Deliberately reads status=demoted AND
 * grade_state=refuted together: a chunk can be demoted for other reasons
 * (R5.3 demotedByReceiptId) without ever having been falsifier-graded, and
 * those are not "this prediction was tested and failed."
 */
export function refutedChunksBySubjectQuery(workspaceId: string, subjectKey: string) {
  return db
    .select({
      id: platinaBrainChunks.id,
      content: platinaBrainChunks.content,
      direction: platinaBrainChunks.direction,
      refutedByGradeId: platinaBrainChunks.refutedByGradeId,
      createdAt: platinaBrainChunks.createdAt,
    })
    .from(platinaBrainChunks)
    .where(
      and(
        eq(platinaBrainChunks.workspaceId, workspaceId),
        eq(platinaBrainChunks.subjectKey, subjectKey),
        eq(platinaBrainChunks.status, "demoted"),
        eq(platinaBrainChunks.gradeState, "refuted"),
      ),
    )
    .orderBy(desc(platinaBrainChunks.createdAt));
}

export async function listRefutedChunksBySubject(workspaceId: string, subjectKey: string) {
  return refutedChunksBySubjectQuery(workspaceId, subjectKey);
}

/**
 * Refuted chunks nearest a question (W3b). Runs in the same parallel batch
 * as the support queries, so the counter-evidence slot costs no extra round
 * trip: diversify.ts keeps the ones on the leading hypothesis's subject.
 */
export function similarRefutedBrainChunksQuery(workspaceId: string, embedding: number[], limit = 10) {
  const distance = cosineDistance(platinaBrainChunks.embedding, embedding);
  return db
    .select({
      id: platinaBrainChunks.id,
      content: platinaBrainChunks.content,
      subjectKey: platinaBrainChunks.subjectKey,
      direction: platinaBrainChunks.direction,
      gradeState: platinaBrainChunks.gradeState,
      status: platinaBrainChunks.status,
      sourceSignalIds: platinaBrainChunks.sourceSignalIds,
      absorbedChunkIds: platinaBrainChunks.absorbedChunkIds,
      generation: platinaBrainChunks.generation,
      confidence: platinaBrainChunks.confidence,
      createdAt: platinaBrainChunks.createdAt,
      score: sql<number>`(1 - (${distance}))`,
    })
    .from(platinaBrainChunks)
    .where(
      and(
        eq(platinaBrainChunks.workspaceId, workspaceId),
        eq(platinaBrainChunks.status, "demoted"),
        eq(platinaBrainChunks.gradeState, "refuted"),
        eq(platinaBrainChunks.embeddingModelVersion, PLATINA_EMBEDDING_MODEL_VERSION),
      ),
    )
    .orderBy(distance)
    .limit(limit);
}

export async function listSimilarRefutedBrainChunks(workspaceId: string, embedding: number[], limit = 10) {
  return similarRefutedBrainChunksQuery(workspaceId, embedding, limit);
}

/**
 * How the evidence a plan cited has fared when tested (B8): refuted chunks
 * with the grade that refuted them, and promoted ones. The plan's evidence
 * snapshot keeps the ids, so this is one lookup with no plan-table change.
 */
export function citedEvidenceVerdictsQuery(workspaceId: string, chunkIds: string[]) {
  return db
    .select({
      id: platinaBrainChunks.id,
      gradeState: platinaBrainChunks.gradeState,
      metric: platinaInsightGrades.metric,
      measuredValue: platinaInsightGrades.measuredValue,
      threshold: platinaInsightGrades.threshold,
      direction: platinaInsightGrades.direction,
      gradedAt: platinaInsightGrades.createdAt,
    })
    .from(platinaBrainChunks)
    .leftJoin(
      platinaInsightGrades,
      and(
        eq(platinaInsightGrades.id, platinaBrainChunks.refutedByGradeId),
        eq(platinaInsightGrades.workspaceId, workspaceId),
      ),
    )
    .where(
      and(
        eq(platinaBrainChunks.workspaceId, workspaceId),
        inArray(platinaBrainChunks.id, chunkIds),
        inArray(platinaBrainChunks.gradeState, ["refuted", "promoted"]),
      ),
    );
}

export async function listCitedEvidenceVerdicts(workspaceId: string, chunkIds: string[]) {
  if (chunkIds.length === 0) return [];
  return citedEvidenceVerdictsQuery(workspaceId, chunkIds);
}

// ---------------------------------------------------------------------------
// Grade counts — Brain quality card (plan §8) and earnedConfidence inputs
// ---------------------------------------------------------------------------

/** Counts per verdict across the whole workspace, for the Admin -> Health "Brain quality" card. */
export function gradeCountsQuery(workspaceId: string) {
  return db
    .select({ verdict: platinaInsightGrades.verdict, count: sql<number>`count(*)::int` })
    .from(platinaInsightGrades)
    .where(eq(platinaInsightGrades.workspaceId, workspaceId))
    .groupBy(platinaInsightGrades.verdict);
}

export async function gradeCounts(workspaceId: string) {
  return gradeCountsQuery(workspaceId);
}

/**
 * Counts per verdict for ONE chunk. Two uses: the held/refuted inputs to
 * earnedConfidence (falsifier-grade.ts) when a grade promotes a chunk, and
 * the insufficient count that gates MAX_INSUFFICIENT_ATTEMPTS (plan §5 B5 —
 * a chunk that keeps measuring "not enough data" stops being retried after
 * `insufficientAttemptsExhausted` says so, falsifier-grade.ts). Because a
 * holding or insufficient chunk gets its due_at pushed forward and is
 * re-tested next window (a new row each time, due_at is part of the unique
 * key), this count can genuinely grow past one over a chunk's life — unlike
 * refuted/promoted, which are terminal and never get a second row.
 */
export function gradeCountsForChunkQuery(workspaceId: string, brainChunkId: string) {
  return db
    .select({ verdict: platinaInsightGrades.verdict, count: sql<number>`count(*)::int` })
    .from(platinaInsightGrades)
    .where(and(eq(platinaInsightGrades.workspaceId, workspaceId), eq(platinaInsightGrades.brainChunkId, brainChunkId)))
    .groupBy(platinaInsightGrades.verdict);
}

export async function gradeCountsForChunk(
  workspaceId: string,
  brainChunkId: string,
): Promise<{ held: number; refuted: number; insufficient: number }> {
  const rows = await gradeCountsForChunkQuery(workspaceId, brainChunkId);
  const held = rows.find((r) => r.verdict === "promoted")?.count ?? 0;
  const refuted = rows.find((r) => r.verdict === "refuted")?.count ?? 0;
  const insufficient = rows.find((r) => r.verdict === "insufficient")?.count ?? 0;
  return { held, refuted, insufficient };
}
