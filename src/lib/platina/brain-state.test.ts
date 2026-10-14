import { describe, expect, it } from "vitest";
import { diffBrainState, inverseOf, refutedByGradeIdPatch, type BrainStateLogRow } from "./brain-state";

describe("diffBrainState", () => {
  it("returns a row only for fields that change", () => {
    const current = { status: "active", confidence: 0.4, agreementState: "agreed" };
    const next = { status: "active", confidence: 0.6 };
    const diff = diffBrainState(current, next);
    expect(diff).toEqual([{ field: "confidence", fromValue: 0.4, toValue: 0.6 }]);
  });

  it("is empty when next matches current exactly", () => {
    const current = { status: "active", confidence: 0.4 };
    expect(diffBrainState(current, { status: "active", confidence: 0.4 })).toEqual([]);
  });

  it("treats a field absent on current as null", () => {
    const diff = diffBrainState({}, { confidence: 0.5 });
    expect(diff).toEqual([{ field: "confidence", fromValue: null, toValue: 0.5 }]);
  });

  it("can diff multiple fields at once, each independently", () => {
    const current = { status: "active", confidence: 0.4, agreementState: "agreed" };
    const next = { status: "demoted", confidence: 0.4, agreementState: "refuted" };
    const diff = diffBrainState(current, next);
    expect(diff).toHaveLength(2);
    expect(diff).toEqual(
      expect.arrayContaining([
        { field: "status", fromValue: "active", toValue: "demoted" },
        { field: "agreementState", fromValue: "agreed", toValue: "refuted" },
      ]),
    );
  });

  it("a next value of null is a real change, not a no-op", () => {
    const diff = diffBrainState({ confidence: 0.4 }, { confidence: null });
    expect(diff).toEqual([{ field: "confidence", fromValue: 0.4, toValue: null }]);
  });

  it("diffs gradeState too (B5)", () => {
    const diff = diffBrainState({ gradeState: "untested" }, { gradeState: "refuted" });
    expect(diff).toEqual([{ field: "gradeState", fromValue: "untested", toValue: "refuted" }]);
  });
});

describe("refutedByGradeIdPatch (B5)", () => {
  const refutedDiff = [{ field: "gradeState" as const, fromValue: "untested", toValue: "refuted" }];
  const promotedDiff = [{ field: "gradeState" as const, fromValue: "untested", toValue: "promoted" }];

  it("is empty when no gradeId is given, even on a refuted diff", () => {
    expect(refutedByGradeIdPatch(refutedDiff, undefined)).toEqual({});
    expect(refutedByGradeIdPatch(refutedDiff, null)).toEqual({});
  });

  it("is empty when the diff does not move gradeState to refuted", () => {
    expect(refutedByGradeIdPatch(promotedDiff, "grade1")).toEqual({});
    expect(refutedByGradeIdPatch([], "grade1")).toEqual({});
  });

  it("sets refutedByGradeId when the diff moves gradeState to refuted and a gradeId is given", () => {
    expect(refutedByGradeIdPatch(refutedDiff, "grade1")).toEqual({ refutedByGradeId: "grade1" });
  });

  it("still fires when gradeState->refuted is one of several changed fields", () => {
    const diff = [
      { field: "status" as const, fromValue: "active", toValue: "demoted" },
      { field: "confidence" as const, fromValue: 0.6, toValue: 0.05 },
      ...refutedDiff,
    ];
    expect(refutedByGradeIdPatch(diff, "grade1")).toEqual({ refutedByGradeId: "grade1" });
  });
});

describe("inverseOf", () => {
  const row = (over: Partial<BrainStateLogRow>): BrainStateLogRow => ({
    brainChunkId: "chunk1",
    field: "confidence",
    fromValue: 0,
    toValue: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  });

  it("is empty for an empty run", () => {
    expect(inverseOf([])).toEqual([]);
  });

  it("inverts a single change: swaps from/to", () => {
    const inverse = inverseOf([row({ fromValue: 0.3, toValue: 0.5 })]);
    expect(inverse).toEqual([{ brainChunkId: "chunk1", field: "confidence", fromValue: 0.5, toValue: 0.3 }]);
  });

  it("collapses a multi-step run into one change back to the earliest value", () => {
    const run = [
      row({ fromValue: 0.3, toValue: 0.5, createdAt: new Date("2026-01-01T00:00:00Z") }),
      row({ fromValue: 0.5, toValue: 0.8, createdAt: new Date("2026-01-02T00:00:00Z") }),
      row({ fromValue: 0.8, toValue: 0.9, createdAt: new Date("2026-01-03T00:00:00Z") }),
    ];
    const inverse = inverseOf(run);
    expect(inverse).toEqual([{ brainChunkId: "chunk1", field: "confidence", fromValue: 0.9, toValue: 0.3 }]);
  });

  it("is order-independent within a run (sorts by createdAt internally)", () => {
    const run = [
      row({ fromValue: 0.8, toValue: 0.9, createdAt: new Date("2026-01-03T00:00:00Z") }),
      row({ fromValue: 0.3, toValue: 0.5, createdAt: new Date("2026-01-01T00:00:00Z") }),
      row({ fromValue: 0.5, toValue: 0.8, createdAt: new Date("2026-01-02T00:00:00Z") }),
    ];
    expect(inverseOf(run)).toEqual([{ brainChunkId: "chunk1", field: "confidence", fromValue: 0.9, toValue: 0.3 }]);
  });

  it("keeps separate chunks and separate fields as separate inverse rows", () => {
    const run = [
      row({ brainChunkId: "chunk1", field: "confidence", fromValue: 0.3, toValue: 0.5 }),
      row({ brainChunkId: "chunk1", field: "status", fromValue: "active", toValue: "demoted" }),
      row({ brainChunkId: "chunk2", field: "confidence", fromValue: 0.1, toValue: 0.2 }),
    ];
    const inverse = inverseOf(run);
    expect(inverse).toHaveLength(3);
    expect(inverse).toEqual(
      expect.arrayContaining([
        { brainChunkId: "chunk1", field: "confidence", fromValue: 0.5, toValue: 0.3 },
        { brainChunkId: "chunk1", field: "status", fromValue: "demoted", toValue: "active" },
        { brainChunkId: "chunk2", field: "confidence", fromValue: 0.2, toValue: 0.1 },
      ]),
    );
  });

  it("orders groups newest-change-first", () => {
    const older = row({
      brainChunkId: "chunk-older",
      fromValue: 0.1,
      toValue: 0.2,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const newer = row({
      brainChunkId: "chunk-newer",
      fromValue: 0.1,
      toValue: 0.2,
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });
    const inverse = inverseOf([older, newer]);
    expect(inverse.map((r) => r.brainChunkId)).toEqual(["chunk-newer", "chunk-older"]);
  });
});
