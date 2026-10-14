/**
 * Falsifier grade queries (B5 — metacognitive Brain). Every query filters
 * workspace_id explicitly (app-layer isolation; see CLAUDE.md) and
 * platina-grades.test.ts asserts it in the generated SQL, following the
 * house pattern in platina-brain.ts / platina-learning.ts.
 *
 * `platina_insight_grades` is append-only: no update/delete query is
 * exported here, matching platina_brain_telemetry and platina_brain_state_log.
 */
import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
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
/** Insufficient is NOT re-queried (plan §5 B5 names only untested|holding); a chunk whose interrogation itself failed validation is never retried by this job. */
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
// Writing a grade — once per (chunk, window, metric)
// ---------------------------------------------------------------------------

export type InsertGradeInput = {
  workspaceId: string;
  brainChunkId: string;
  metric: string;
  scaleVersion: number;
  windowDays: number;
  threshold: number;
  direction: "above" | "below";
  measuredValue: number | null;
  n: number;
  verdict: InsightGradeVerdict;
  plane: Plane;
};

/**
 * Idempotent per (brain_chunk_id, window_days, metric) — ON CONFLICT DO
 * NOTHING on exactly that unique key, so a crash-replay of the same page
 * (plan §12) never writes a second grade for a chunk already graded.
 * `inserted: false` on a conflict means "already graded"; the caller skips
 * any further state change rather than re-deciding it.
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
        eq(platinaInsightGrades.windowDays, input.windowDays),
        eq(platinaInsightGrades.metric, input.metric),
      ),
    )
    .limit(1);
  return { id: existing.id, inserted: false };
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
 * Counts per verdict for ONE chunk — the held/refuted inputs to
 * earnedConfidence (falsifier-grade.ts) when a grade promotes a chunk. In
 * practice at most one grade row exists per chunk (the unique key is
 * per-chunk-per-window, and a chunk's falsifier never changes its window),
 * so this is usually {held: 0, refuted: 0} before the grade just inserted.
 * It is written as a general count, not a boolean, so a future chunk that
 * accumulates more than one grade (e.g. a later metric revision) is already
 * handled correctly.
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
): Promise<{ held: number; refuted: number }> {
  const rows = await gradeCountsForChunkQuery(workspaceId, brainChunkId);
  const held = rows.find((r) => r.verdict === "promoted")?.count ?? 0;
  const refuted = rows.find((r) => r.verdict === "refuted")?.count ?? 0;
  return { held, refuted };
}
