/**
 * Brain state diffing + undo (B0 — metacognitive Brain; `gradeState` added in
 * B5). Every status, confidence, agreement_state or grade_state change a new
 * stage makes is written through one path (`setBrainState` in
 * db/queries/platina-brain.ts), which logs the change here, in
 * `platina_brain_state_log` — the undo journal (plan §11.2). Pure: no DB, no
 * dates beyond what is handed in.
 */

/** Closed union so a typo cannot silently no-op. B5 added "gradeState" (grade_state). */
export type BrainStateField = "status" | "confidence" | "agreementState" | "gradeState";

export type BrainStateValue = string | number | null;

/** The fields of a Brain chunk this module knows how to diff; absent keys are untouched. */
export type BrainState = Partial<Record<BrainStateField, BrainStateValue>>;

export type BrainStateDiffRow = {
  field: BrainStateField;
  fromValue: BrainStateValue;
  toValue: BrainStateValue;
};

/** Only the fields present on `next` whose value actually differs from `current`. */
export function diffBrainState(current: BrainState, next: BrainState): BrainStateDiffRow[] {
  const rows: BrainStateDiffRow[] = [];
  for (const field of Object.keys(next) as BrainStateField[]) {
    const toValue = next[field] ?? null;
    const fromValue = current[field] ?? null;
    if (fromValue !== toValue) {
      rows.push({ field, fromValue, toValue });
    }
  }
  return rows;
}

/** A logged state change, as stored in platina_brain_state_log. */
export type BrainStateLogRow = {
  brainChunkId: string;
  field: BrainStateField;
  fromValue: BrainStateValue;
  toValue: BrainStateValue;
  createdAt: Date;
};

export type BrainStateInverseRow = {
  brainChunkId: string;
  field: BrainStateField;
  fromValue: BrainStateValue;
  toValue: BrainStateValue;
};

/**
 * The state changes that undo a run of log rows: one inverse change per
 * (chunk, field), returning it from its current value to the value it held
 * before the EARLIEST row in the run. Groups with a more recent change are
 * returned first ("newest first"), since an operator reviewing a rollback
 * reads the most recent damage first.
 */
export function inverseOf(logRows: BrainStateLogRow[]): BrainStateInverseRow[] {
  const groups = new Map<string, BrainStateLogRow[]>();
  for (const row of logRows) {
    const key = `${row.brainChunkId}\u0000${row.field}`;
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }

  const withOrder: (BrainStateInverseRow & { latestAt: number })[] = [];
  for (const rows of groups.values()) {
    const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const earliest = sorted[0];
    const latest = sorted[sorted.length - 1];
    withOrder.push({
      brainChunkId: earliest.brainChunkId,
      field: earliest.field,
      // Undo moves the field from what it is now (latest.toValue) back to
      // what it was before any row in this run (earliest.fromValue).
      fromValue: latest.toValue,
      toValue: earliest.fromValue,
      latestAt: latest.createdAt.getTime(),
    });
  }

  withOrder.sort((a, b) => b.latestAt - a.latestAt);
  return withOrder.map(({ latestAt, ...rest }) => {
    void latestAt;
    return rest;
  });
}

// ---------------------------------------------------------------------------
// B5 — refuted_by_grade_id side-write
// ---------------------------------------------------------------------------

/**
 * `platina_brain_chunks.refuted_by_grade_id` is not one of the four diffed
 * state fields (it is set once, never undone by `inverseOf`), but it must be
 * written in the SAME transaction as the `gradeState -> "refuted"` change, so
 * it cannot drift from it. Pure so the rule — "only when this diff actually
 * moves gradeState to refuted, and only when the caller gave a grade id" — is
 * unit tested without a transaction; `setBrainState` merges this onto its
 * normal column patch.
 */
export function refutedByGradeIdPatch(
  diff: BrainStateDiffRow[],
  gradeId: string | null | undefined,
): { refutedByGradeId: string } | Record<string, never> {
  if (!gradeId) return {};
  const refuted = diff.some((row) => row.field === "gradeState" && row.toValue === "refuted");
  return refuted ? { refutedByGradeId: gradeId } : {};
}
