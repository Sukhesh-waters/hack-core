import { describe, expect, it } from "vitest";
import {
  parseRecoveryArgs,
  planRestore,
  planReplay,
  planUndo,
  type BrainSnapshot,
  type BrainSnapshotChunk,
  type BrainStateLogRowWithCause,
  type ReplayCandidateDoc,
} from "./brain-recovery";

const chunk = (over: Partial<BrainSnapshotChunk>): BrainSnapshotChunk => ({
  id: "c1",
  status: "active",
  confidence: 0.6,
  agreementState: "agreed",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const snapshot = (over: Partial<BrainSnapshot> = {}): BrainSnapshot => ({
  version: 1,
  workspaceId: "ws1",
  slug: "waters-gcc-internal",
  takenAt: "2026-01-10T00:00:00.000Z",
  modes: { gate: "shadow" },
  config: { surpriseFloor: 1.0, surpriseAuditShare: 0.1, derivedContextShare: 0.4 },
  chunks: [chunk({})],
  funnel: [],
  ...over,
});

describe("planRestore", () => {
  it("unchanged chunks produce no state change", () => {
    const snap = snapshot();
    const plan = planRestore(snap, [chunk({})]);
    expect(plan.stateChanges).toEqual([]);
    expect(plan.archive).toEqual([]);
  });

  it("a changed chunk produces one state change back to the snapshot's values", () => {
    const snap = snapshot({ chunks: [chunk({ confidence: 0.9, status: "demoted" })] });
    const live = [chunk({ confidence: 0.2, status: "active" })];
    const plan = planRestore(snap, live);
    expect(plan.stateChanges).toEqual([
      { chunkId: "c1", next: { status: "demoted", confidence: 0.9, agreementState: "agreed" } },
    ]);
  });

  it("a row created after the snapshot and absent from it is archived, not deleted", () => {
    const snap = snapshot({ chunks: [chunk({})] });
    const live = [
      chunk({}),
      chunk({ id: "c2", createdAt: "2026-01-15T00:00:00.000Z", status: "active" }),
    ];
    const plan = planRestore(snap, live, { archiveNew: true });
    expect(plan.archive).toEqual(["c2"]);
    // Archiving happens through setBrainState at the caller, not a delete —
    // planRestore only ever names ids, never removes a row.
    expect(plan.stateChanges.find((s) => s.chunkId === "c2")).toBeUndefined();
  });

  it("by default a post-snapshot row is reported but left alone (live pipeline keeps writing real insights)", () => {
    const snap = snapshot({ chunks: [chunk({})] });
    const live = [chunk({}), chunk({ id: "c2", createdAt: "2026-01-15T00:00:00.000Z", status: "active" })];
    const plan = planRestore(snap, live);
    expect(plan.newSinceSnapshot).toEqual(["c2"]);
    expect(plan.archive).toEqual([]);
  });

  it("parses --archive-new", () => {
    const parsed = parseRecoveryArgs(["--restore", "f.json", "--archive-new"]);
    expect(parsed.ok && parsed.args.archiveNew).toBe(true);
  });

  it("an already-archived post-snapshot row is skipped, not re-archived", () => {
    const snap = snapshot({ chunks: [chunk({})] });
    const live = [
      chunk({}),
      chunk({ id: "c2", createdAt: "2026-01-15T00:00:00.000Z", status: "archived" }),
    ];
    const plan = planRestore(snap, live, { archiveNew: true });
    expect(plan.archive).toEqual([]);
  });

  it("a row created before the snapshot but absent from it (should not happen) is left alone", () => {
    const snap = snapshot({ chunks: [chunk({})] });
    const live = [chunk({}), chunk({ id: "c2", createdAt: "2025-01-01T00:00:00.000Z" })];
    const plan = planRestore(snap, live);
    expect(plan.archive).toEqual([]);
  });

  it("passes the snapshot's modes through untouched", () => {
    const snap = snapshot({ modes: { gate: "on", surprise: "shadow" } });
    const plan = planRestore(snap, [chunk({})]);
    expect(plan.modes).toEqual({ gate: "on", surprise: "shadow" });
  });
});

describe("planUndo", () => {
  const row = (over: Partial<BrainStateLogRowWithCause>): BrainStateLogRowWithCause => ({
    brainChunkId: "chunk1",
    field: "confidence",
    fromValue: 0,
    toValue: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    cause: "grading",
    ...over,
  });

  it("a chain of 3 changes returns to the original value", () => {
    const rows = [
      row({ fromValue: 0.1, toValue: 0.4, createdAt: new Date("2026-01-01T00:00:00Z") }),
      row({ fromValue: 0.4, toValue: 0.7, createdAt: new Date("2026-01-02T00:00:00Z") }),
      row({ fromValue: 0.7, toValue: 0.9, createdAt: new Date("2026-01-03T00:00:00Z") }),
    ];
    const inverse = planUndo(rows, { cause: "grading", since: new Date("2026-01-01T00:00:00Z") });
    expect(inverse).toEqual([{ brainChunkId: "chunk1", field: "confidence", fromValue: 0.9, toValue: 0.1 }]);
  });

  it("filters to the given cause only", () => {
    const rows = [
      row({ cause: "grading", fromValue: 0.1, toValue: 0.4 }),
      row({ cause: "gate", brainChunkId: "chunk2", fromValue: 0, toValue: 1 }),
    ];
    const inverse = planUndo(rows, { cause: "grading", since: new Date("2025-01-01T00:00:00Z") });
    expect(inverse).toEqual([{ brainChunkId: "chunk1", field: "confidence", fromValue: 0.4, toValue: 0.1 }]);
  });

  it("filters out rows before `since`", () => {
    const rows = [
      row({ cause: "grading", createdAt: new Date("2025-01-01T00:00:00Z"), fromValue: 0.1, toValue: 0.4 }),
      row({ cause: "grading", createdAt: new Date("2026-06-01T00:00:00Z"), fromValue: 0.4, toValue: 0.9 }),
    ];
    const inverse = planUndo(rows, { cause: "grading", since: new Date("2026-01-01T00:00:00Z") });
    expect(inverse).toEqual([{ brainChunkId: "chunk1", field: "confidence", fromValue: 0.9, toValue: 0.4 }]);
  });

  it("without a cause, excludes rows caused by a prior undo by default", () => {
    const rows = [
      row({ cause: "grading", fromValue: 0.1, toValue: 0.4 }),
      row({ cause: "undo:1700000000000", brainChunkId: "chunk2", fromValue: 0, toValue: 1 }),
    ];
    const inverse = planUndo(rows, { since: new Date("2025-01-01T00:00:00Z") });
    expect(inverse).toEqual([{ brainChunkId: "chunk1", field: "confidence", fromValue: 0.4, toValue: 0.1 }]);
  });

  it("undoing a prior undo requires asking for it by its exact cause", () => {
    const rows = [row({ cause: "undo:1700000000000", brainChunkId: "chunk2", fromValue: 0, toValue: 1 })];
    const inverse = planUndo(rows, { cause: "undo:1700000000000", since: new Date("2025-01-01T00:00:00Z") });
    expect(inverse).toEqual([{ brainChunkId: "chunk2", field: "confidence", fromValue: 1, toValue: 0 }]);
  });
});

describe("planReplay", () => {
  const doc = (over: Partial<ReplayCandidateDoc>): ReplayCandidateDoc => ({
    id: "d1",
    skipCause: "surprise",
    fetchedAt: new Date("2026-01-05T00:00:00Z"),
    ...over,
  });

  it("selects only docs matching the cause and since, with the cost estimate", () => {
    const docs = [
      doc({ id: "d1" }),
      doc({ id: "d2", skipCause: "gate" }),
      doc({ id: "d3", fetchedAt: new Date("2025-01-01T00:00:00Z") }),
    ];
    const plan = planReplay(docs, { cause: "surprise", since: new Date("2026-01-01T00:00:00Z") });
    expect(plan.selectedIds).toEqual(["d1"]);
    expect(plan.estimatedModelCalls).toBe(2);
    expect(plan.summary).toContain("1 document");
  });

  it("applies a limit after filtering", () => {
    const docs = [doc({ id: "d1" }), doc({ id: "d2" }), doc({ id: "d3" })];
    const plan = planReplay(docs, { cause: "surprise", since: new Date("2026-01-01T00:00:00Z"), limit: 2 });
    expect(plan.selectedIds).toEqual(["d1", "d2"]);
    expect(plan.estimatedModelCalls).toBe(4);
  });

  it("zero matches is a plain-words no-op, not an error", () => {
    const plan = planReplay([], { cause: "untestable", since: new Date("2026-01-01T00:00:00Z") });
    expect(plan.selectedIds).toEqual([]);
    expect(plan.estimatedModelCalls).toBe(0);
    expect(plan.summary).toContain("Nothing to replay");
  });
});

describe("parseRecoveryArgs", () => {
  it("parses a full set of valid flags", () => {
    const result = parseRecoveryArgs([
      "--ws", "waters-gcc-internal",
      "--stage", "gate",
      "--mode", "shadow",
      "--cause", "grading",
      "--since", "2026-01-01T00:00:00Z",
      "--limit", "10",
      "--apply",
      "--restore", "backups/x.json",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.args).toEqual({
      ws: "waters-gcc-internal",
      stage: "gate",
      mode: "shadow",
      cause: "grading",
      since: new Date("2026-01-01T00:00:00Z"),
      limit: 10,
      apply: true,
      restore: "backups/x.json",
      archiveNew: false,
    });
  });

  it("every flag is optional; omitted flags are null/false", () => {
    const result = parseRecoveryArgs(["--ws", "ws1"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.args).toEqual({
      ws: "ws1",
      stage: null,
      mode: null,
      cause: null,
      since: null,
      limit: null,
      apply: false,
      restore: null,
      archiveNew: false,
    });
  });

  it("rejects an unknown stage in plain words", () => {
    const result = parseRecoveryArgs(["--stage", "not-a-stage"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/unknown stage "not-a-stage"/);
  });

  it("rejects an unknown mode in plain words", () => {
    const result = parseRecoveryArgs(["--mode", "maybe"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/unknown mode "maybe"/);
  });

  it("rejects a malformed --since date", () => {
    const result = parseRecoveryArgs(["--since", "not-a-date"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/invalid --since/);
  });

  it("rejects a non-positive or non-integer --limit", () => {
    for (const bad of ["0", "-5", "abc", "3.5"]) {
      const result = parseRecoveryArgs(["--limit", bad]);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error).toMatch(/invalid --limit/);
    }
  });
});
