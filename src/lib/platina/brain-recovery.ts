/**
 * Recovery planning (B0 — metacognitive Brain, plan §11; gradeState added in
 * B5). Pure: every decision a recovery script makes is computed here and
 * unit tested; the scripts in scripts/platina-brain-*.ts stay thin (parse
 * args, read/write the DB, call these, print the result). Nothing here
 * deletes a row — "restore" and "undo" only ever change
 * status/confidence/agreement_state/grade_state (through setBrainState,
 * db/queries/platina-brain.ts) or archive a chunk.
 *
 * `refuted_by_grade_id` is deliberately NOT part of the snapshot/restore
 * cycle: it is derived — it just names whichever grade row refuted the
 * chunk — not independent state a restore could meaningfully set back. A
 * restored chunk's gradeState can leave it pointing at a grade that no
 * longer matches (e.g. restored from "refuted" to "holding"); that is a
 * pre-existing B5 id, not a dangling reference, and setBrainState's own
 * refutedByGradeIdPatch only ever sets it going forward on a NEW refutation,
 * never clears it on restore.
 *
 * TODO (B4, §11.1 L3): a `--rebuild-expectations` recompute of
 * platina_expectations from signal-document history is NOT in scope here —
 * that table does not exist until B4. When it ships, its rebuild plan
 * belongs beside planRestore/planReplay in this file.
 */
import { BRAIN_STAGES, type BrainMode, type BrainModes, type BrainStage } from "./brain-modes";
import { diffBrainState, inverseOf, type BrainState, type BrainStateInverseRow, type BrainStateLogRow } from "./brain-state";

// ---------------------------------------------------------------------------
// Snapshot (plan §11.4)
// ---------------------------------------------------------------------------

/**
 * A Brain chunk's recoverable fields, as read for a snapshot or a restore
 * comparison. `refuted_by_grade_id` is intentionally absent — see this
 * file's header comment.
 */
export type BrainSnapshotChunk = {
  id: string;
  status: string;
  confidence: number;
  agreementState: string;
  /** B5: untested | holding | promoted | refuted | insufficient. */
  gradeState: string;
  /** ISO timestamp — the snapshot file is JSON on disk. */
  createdAt: string;
};

export type BrainSnapshotConfig = {
  surpriseFloor: number;
  surpriseAuditShare: number;
  derivedContextShare: number;
};

export type BrainFunnelRow = { stage: string; decision: string; count: number };

export type BrainSnapshot = {
  version: 1;
  workspaceId: string;
  slug: string;
  /** ISO timestamp of the moment the snapshot was taken. */
  takenAt: string;
  stage?: BrainStage;
  modes: BrainModes;
  config: BrainSnapshotConfig;
  chunks: BrainSnapshotChunk[];
  funnel: BrainFunnelRow[];
};

export type BrainRestoreStateChange = { chunkId: string; next: BrainState };

export type BrainRestorePlan = {
  /** Only chunks whose status/confidence/agreementState/gradeState differs from the snapshot. */
  stateChanges: BrainRestoreStateChange[];
  /**
   * Chunk ids created after the snapshot, absent from it, and not already
   * archived. Includes rows the unchanged live pipeline wrote since then.
   */
  newSinceSnapshot: string[];
  /**
   * What the restore will archive: empty unless the operator passes
   * --archive-new. Until B1's written_by marker exists, new rows from the
   * live pipeline cannot be told apart from rows a new stage wrote, and
   * archiving fresh, legitimate insights is worse than leaving them.
   */
  archive: string[];
  modes: BrainModes;
};

/**
 * What restoring `snapshot` over `currentChunks` (the live rows, same shape)
 * would change. Never touches content or embeddings — they are not part of
 * either shape. A chunk the snapshot knows about but that no longer exists
 * live cannot be recreated (rows are never deleted, so this should not
 * happen) and is silently skipped rather than guessed at.
 */
export function planRestore(
  snapshot: BrainSnapshot,
  currentChunks: BrainSnapshotChunk[],
  options: { archiveNew?: boolean } = {},
): BrainRestorePlan {
  const bySnapshotId = new Map(snapshot.chunks.map((c) => [c.id, c]));
  const takenAt = new Date(snapshot.takenAt).getTime();

  const stateChanges: BrainRestoreStateChange[] = [];
  const newSinceSnapshot: string[] = [];

  for (const current of currentChunks) {
    const snapChunk = bySnapshotId.get(current.id);
    if (snapChunk) {
      const diff = diffBrainState(
        {
          status: current.status,
          confidence: current.confidence,
          agreementState: current.agreementState,
          gradeState: current.gradeState,
        },
        {
          status: snapChunk.status,
          confidence: snapChunk.confidence,
          agreementState: snapChunk.agreementState,
          gradeState: snapChunk.gradeState,
        },
      );
      if (diff.length > 0) {
        stateChanges.push({
          chunkId: current.id,
          next: {
            status: snapChunk.status,
            confidence: snapChunk.confidence,
            agreementState: snapChunk.agreementState,
            gradeState: snapChunk.gradeState,
          },
        });
      }
      continue;
    }
    // Not in the snapshot: only a chunk created after the snapshot was taken
    // is "new since then" rather than some other data shape mismatch.
    const createdAfter = new Date(current.createdAt).getTime() > takenAt;
    if (createdAfter && current.status !== "archived") {
      newSinceSnapshot.push(current.id);
    }
  }

  return {
    stateChanges,
    newSinceSnapshot,
    archive: options.archiveNew ? [...newSinceSnapshot] : [],
    modes: snapshot.modes,
  };
}

// ---------------------------------------------------------------------------
// Undo (plan §11.2)
// ---------------------------------------------------------------------------

/**
 * A state-log row as read from the DB (platina_brain_state_log), which
 * carries `cause` — unlike `BrainStateLogRow` from brain-state.ts, whose
 * `inverseOf` only ever sees a run already selected by cause.
 */
export type BrainStateLogRowWithCause = BrainStateLogRow & { cause: string };

export type BrainUndoFilter = { cause?: string; since: Date };

const isUndoCause = (cause: string) => cause.startsWith("undo:");

/**
 * The state changes that undo everything logged for `cause` since `since`.
 * When `cause` is omitted, every cause since `since` is undone EXCEPT rows
 * whose own cause starts with "undo:" — an undo never silently sweeps up a
 * prior undo. To undo a specific prior undo, the caller asks for it by name:
 * pass that exact cause, e.g. `{ cause: "undo:1760000000000", since }`.
 */
export function planUndo(logRows: BrainStateLogRowWithCause[], filter: BrainUndoFilter): BrainStateInverseRow[] {
  const { cause, since } = filter;
  const matched = logRows.filter((row) => {
    if (row.createdAt < since) return false;
    if (cause !== undefined) return row.cause === cause;
    return !isUndoCause(row.cause);
  });
  return inverseOf(matched);
}

// ---------------------------------------------------------------------------
// Replay (plan §11.3)
// ---------------------------------------------------------------------------

/** A skipped signal document, as read for a replay candidate list. */
export type ReplayCandidateDoc = { id: string; skipCause: string | null; fetchedAt: Date };

export type ReplayFilter = { cause: string; since: Date; limit?: number };

export type ReplayPlan = {
  selectedIds: string[];
  /** Proposer + challenger: two model calls per re-analysed document (plan §0). */
  estimatedModelCalls: number;
  summary: string;
};

/**
 * Which skipped documents a replay would requeue, and roughly what it would
 * cost. Defensive about its own filter (cause/since/limit) rather than
 * trusting the caller already applied them — the DB read this is fed from
 * may be wider than one (cause, since) pair.
 */
export function planReplay(docs: ReplayCandidateDoc[], filter: ReplayFilter): ReplayPlan {
  const matched = docs.filter((d) => d.skipCause === filter.cause && d.fetchedAt >= filter.since);
  const selected = typeof filter.limit === "number" ? matched.slice(0, filter.limit) : matched;
  const n = selected.length;
  const estimatedModelCalls = 2 * n;

  const sinceText = filter.since.toISOString();
  const summary =
    n === 0
      ? `No documents skipped for "${filter.cause}" since ${sinceText}. Nothing to replay.`
      : `${n} document${n === 1 ? "" : "s"} skipped for "${filter.cause}" since ${sinceText} would be ` +
        `reset to unprocessed — about ${estimatedModelCalls} model call${estimatedModelCalls === 1 ? "" : "s"} ` +
        `once the normal sweep picks them up (same job, throttle, daily cap).`;

  return { selectedIds: selected.map((d) => d.id), estimatedModelCalls, summary };
}

// ---------------------------------------------------------------------------
// Shared argument parsing for scripts/platina-brain-*.ts
// ---------------------------------------------------------------------------

const VALID_MODES: ReadonlySet<string> = new Set(["off", "shadow", "on"]);

export type RecoveryArgs = {
  ws: string | null;
  stage: BrainStage | null;
  mode: BrainMode | null;
  cause: string | null;
  since: Date | null;
  limit: number | null;
  apply: boolean;
  restore: string | null;
  /** Restore only: also archive rows created since the snapshot. */
  archiveNew: boolean;
};

export type ParseRecoveryArgsResult = { ok: true; args: RecoveryArgs } | { ok: false; error: string };

/**
 * Parses the flags shared by the four recovery scripts: --ws, --stage,
 * --mode, --cause, --since (ISO), --limit, --apply, --restore <file>. Only
 * validates the SHAPE of a flag that is present — which flags are required
 * differs per script, so that check is each script's own usage message.
 * Errors are plain words an operator typing a flag by hand can act on.
 */
export function parseRecoveryArgs(argv: string[]): ParseRecoveryArgsResult {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const has = (name: string) => argv.includes(`--${name}`);

  const stageRaw = get("stage");
  if (stageRaw !== undefined && !(BRAIN_STAGES as readonly string[]).includes(stageRaw)) {
    return { ok: false, error: `unknown stage "${stageRaw}" — expected one of: ${BRAIN_STAGES.join(", ")}` };
  }

  const modeRaw = get("mode");
  if (modeRaw !== undefined && !VALID_MODES.has(modeRaw)) {
    return { ok: false, error: `unknown mode "${modeRaw}" — expected one of: off, shadow, on` };
  }

  const sinceRaw = get("since");
  let since: Date | null = null;
  if (sinceRaw !== undefined) {
    const parsed = new Date(sinceRaw);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: `invalid --since "${sinceRaw}" — expected an ISO date, e.g. 2026-10-01T00:00:00Z` };
    }
    since = parsed;
  }

  const limitRaw = get("limit");
  let limit: number | null = null;
  if (limitRaw !== undefined) {
    const parsed = Number(limitRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return { ok: false, error: `invalid --limit "${limitRaw}" — expected a positive whole number` };
    }
    limit = parsed;
  }

  return {
    ok: true,
    args: {
      ws: get("ws") ?? null,
      stage: (stageRaw as BrainStage | undefined) ?? null,
      mode: (modeRaw as BrainMode | undefined) ?? null,
      cause: get("cause") ?? null,
      since,
      limit,
      apply: has("apply"),
      restore: get("restore") ?? null,
      archiveNew: has("archive-new"),
    },
  };
}
