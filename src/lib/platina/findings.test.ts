import { describe, expect, it } from "vitest";
import {
  canRule,
  FINDING_STATUSES,
  findingPathFor,
  isRulingVerdict,
} from "./findings";

describe("findingPathFor", () => {
  it("agreed becomes a visible finding and a Brain chunk", () => {
    expect(findingPathFor("agreed")).toEqual({
      finding: "new",
      brainChunk: true,
    });
  });

  it("qualified follows the agreed path in 3.5 (it survived contradiction)", () => {
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

describe("ruling guard", () => {
  it("only a finding awaiting a decision can be ruled", () => {
    expect(canRule("needs_decision")).toBe(true);
    for (const status of FINDING_STATUSES) {
      if (status !== "needs_decision") expect(canRule(status)).toBe(false);
    }
  });

  it("accepts only the two verdicts", () => {
    expect(isRulingVerdict("validated")).toBe(true);
    expect(isRulingVerdict("refuted")).toBe(true);
    expect(isRulingVerdict("dismissed")).toBe(false);
    expect(isRulingVerdict("")).toBe(false);
  });
});
