/**
 * Recovery reads/writes (B0 — metacognitive Brain, plan §11). Feeds the pure
 * planners in lib/platina/brain-recovery.ts: a snapshot's chunk list, a
 * replay's skipped-document candidates, and the reset that lets a replayed
 * document be picked up by the normal `platina/signal.analyze` sweep. Every
 * query filters workspace_id explicitly; platina-brain-recovery.test.ts
 * asserts it in the generated SQL, following the house pattern in
 * platina-learning.test.ts.
 */
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { platinaBrainChunks, platinaSignalDocuments, type BrainSkipCause } from "@/db/platina-schema";

// ---------------------------------------------------------------------------
// Brain chunk states — the snapshot's and restore's view of a chunk
// ---------------------------------------------------------------------------

/**
 * A Brain chunk's recoverable fields for a whole workspace, oldest first.
 * `gradeState` (B5) joins status/confidence/agreementState here because
 * `setBrainState` now journals it too (brain-state.ts BrainStateField).
 * `refuted_by_grade_id` is deliberately NOT selected: it is derived from
 * whichever grade row refuted the chunk, not independent state, so a
 * restore never tries to set it back — see planRestore's doc comment.
 */
export function brainChunkStatesQuery(workspaceId: string) {
  return db
    .select({
      id: platinaBrainChunks.id,
      status: platinaBrainChunks.status,
      confidence: platinaBrainChunks.confidence,
      agreementState: platinaBrainChunks.agreementState,
      gradeState: platinaBrainChunks.gradeState,
      createdAt: platinaBrainChunks.createdAt,
    })
    .from(platinaBrainChunks)
    .where(eq(platinaBrainChunks.workspaceId, workspaceId))
    .orderBy(asc(platinaBrainChunks.createdAt));
}

export async function listBrainChunkStates(workspaceId: string) {
  return brainChunkStatesQuery(workspaceId);
}

// ---------------------------------------------------------------------------
// Skipped signal documents — a replay's candidate list
// ---------------------------------------------------------------------------

/**
 * Documents skipped (terminal `processed` state, a `skip_cause` set) for one
 * machine-readable cause since a moment — `planReplay`'s input. A skip is
 * never a separate processing_state from "processed" (see markSignalSkipped
 * in db/queries/platina.ts); `skip_cause` is what tells the two apart.
 */
export function skippedSignalsQuery(workspaceId: string, cause: BrainSkipCause, since: Date) {
  return db
    .select({
      id: platinaSignalDocuments.id,
      skipCause: platinaSignalDocuments.skipCause,
      fetchedAt: platinaSignalDocuments.fetchedAt,
    })
    .from(platinaSignalDocuments)
    .where(
      and(
        eq(platinaSignalDocuments.workspaceId, workspaceId),
        eq(platinaSignalDocuments.processingState, "processed"),
        eq(platinaSignalDocuments.skipCause, cause),
        gte(platinaSignalDocuments.fetchedAt, since),
      ),
    )
    .orderBy(asc(platinaSignalDocuments.fetchedAt));
}

export async function listSkippedSignals(workspaceId: string, cause: BrainSkipCause, since: Date) {
  return skippedSignalsQuery(workspaceId, cause, since);
}

/**
 * Resets exactly these documents (workspace-filtered, id-list-bound) back to
 * `unprocessed` with the skip cleared, so the normal `platina/signal.analyze`
 * sweep picks them up again — same job, same `claimSignal`, same throttle,
 * same daily cap (plan §11.3). Never touches a document outside `ids`.
 */
export function resetSkippedSignalsQuery(workspaceId: string, ids: string[]) {
  return db
    .update(platinaSignalDocuments)
    .set({
      processingState: "unprocessed",
      skipReason: null,
      skipCause: null,
      processingStartedAt: null,
    })
    .where(and(eq(platinaSignalDocuments.workspaceId, workspaceId), inArray(platinaSignalDocuments.id, ids)))
    .returning({ id: platinaSignalDocuments.id });
}

export async function resetSkippedSignals(workspaceId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return resetSkippedSignalsQuery(workspaceId, ids);
}
