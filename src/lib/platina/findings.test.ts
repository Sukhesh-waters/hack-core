import { describe, expect, it } from "vitest";
import {
  canTransitionFinding,
  FINDING_STATUSES,
  FINDING_TRANSITIONS,
  findingPathFor,
  isFindingVerdict,
} from "./findings";

describe("findingPathFor", () => {
  it("agreed becomes a visible finding and a Brain chunk", () => {
    expect(findingPathFor("agreed")).toEqual({
      finding: "new",
      brainChunk: true,
    });
  });

  it("qualified follows the agreed path (it survived with a caveat)", () => {
    expect(findingPathFor("qualified")).toEqual({
      finding: "new",
      brainChunk: true,
    });
  });

  it("contested becomes a finding awaiting a human, with no Brain chunk", () => {
    expect(findingPathFor("contested")).toEqual({
      finding: "needs_decision",
      brainChunk: false,
    });
  });

  it("refuted leaves only the transcript — no finding, no chunk", () => {
    expect(findingPathFor("refuted")).toEqual({
      finding: null,
      brainChunk: false,
    });
  });
});

describe("finding review transitions", () => {
  it("new → validated | dismissed", () => {
    expect(canTransitionFinding("new", "validated")).toBe(true);
    expect(canTransitionFinding("new", "dismissed")).toBe(true);
    expect(canTransitionFinding("new", "refuted")).toBe(false);
    expect(canTransitionFinding("new", "superseded")).toBe(false);
  });

  it("needs_decision → validated | refuted | dismissed", () => {
    expect(canTransitionFinding("needs_decision", "validated")).toBe(true);
    expect(canTransitionFinding("needs_decision", "refuted")).toBe(true);
    expect(canTransitionFinding("needs_decision", "dismissed")).toBe(true);
    expect(canTransitionFinding("needs_decision", "superseded")).toBe(false);
  });

  it("validated → superseded only", () => {
    expect(canTransitionFinding("validated", "superseded")).toBe(true);
    expect(canTransitionFinding("validated", "dismissed")).toBe(false);
    expect(canTransitionFinding("validated", "refuted")).toBe(false);
  });

  it("terminal states have no transitions", () => {
    for (const terminal of ["refuted", "dismissed", "superseded"] as const) {
      expect(FINDING_TRANSITIONS[terminal]).toEqual([]);
      for (const status of FINDING_STATUSES) {
        expect(canTransitionFinding(terminal, status)).toBe(false);
      }
    }
  });

  it("every declared status has a transition entry", () => {
    for (const status of FINDING_STATUSES) {
      expect(FINDING_TRANSITIONS[status]).toBeDefined();
    }
  });

  it("accepts only the four review verdicts", () => {
    for (const v of ["validated", "refuted", "dismissed", "superseded"]) {
      expect(isFindingVerdict(v)).toBe(true);
    }
    expect(isFindingVerdict("approved")).toBe(false);
    expect(isFindingVerdict("")).toBe(false);
  });
});
