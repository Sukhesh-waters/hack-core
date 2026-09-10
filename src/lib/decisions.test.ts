import { describe, expect, it } from "vitest";
import {
  validateDecisionEvidence,
  isDueForReview,
  canTransitionOutcome,
  DECISION_OUTCOME_LABELS,
} from "./decisions";

describe("validateDecisionEvidence (two-layer rule, I2)", () => {
  const allowed = ["post_1", "post_2", "post_3"];

  it("keeps ids that are real first-party posts", () => {
    expect(validateDecisionEvidence(["post_1", "post_3"], allowed)).toEqual([
      "post_1",
      "post_3",
    ]);
  });

  it("strips a pattern-layer id (the leak this exists to prevent)", () => {
    expect(
      validateDecisionEvidence(["post_1", "pattern_post_9"], allowed),
    ).toEqual(["post_1"]);
  });

  it("strips a forged id that was never in the allow-list", () => {
    expect(validateDecisionEvidence(["post_1", "totally_made_up"], allowed))
      .toEqual(["post_1"]);
  });

  it("returns empty rather than throwing when nothing survives", () => {
    expect(validateDecisionEvidence(["pattern_post_9"], allowed)).toEqual([]);
  });

  it("never invents an id that was not submitted", () => {
    expect(validateDecisionEvidence([], allowed)).toEqual([]);
  });
});

describe("isDueForReview", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  it("is due when reviewAt has passed and the outcome is still pending", () => {
    expect(
      isDueForReview(
        { reviewAt: new Date("2026-06-14"), outcome: "pending" },
        now,
      ),
    ).toBe(true);
  });

  it("is due at exactly the review moment", () => {
    expect(isDueForReview({ reviewAt: now, outcome: "pending" }, now)).toBe(true);
  });

  it("is not due before the review date", () => {
    expect(
      isDueForReview(
        { reviewAt: new Date("2026-06-16"), outcome: "pending" },
        now,
      ),
    ).toBe(false);
  });

  it("is not due once an outcome has been recorded", () => {
    expect(
      isDueForReview(
        { reviewAt: new Date("2026-06-14"), outcome: "worked" },
        now,
      ),
    ).toBe(false);
  });
});

describe("canTransitionOutcome", () => {
  it("allows pending to any terminal outcome", () => {
    expect(canTransitionOutcome("pending", "worked")).toBe(true);
    expect(canTransitionOutcome("pending", "did_not_work")).toBe(true);
    expect(canTransitionOutcome("pending", "inconclusive")).toBe(true);
  });

  it("refuses to reopen a decided outcome", () => {
    expect(canTransitionOutcome("worked", "pending")).toBe(false);
    expect(canTransitionOutcome("did_not_work", "worked")).toBe(false);
    expect(canTransitionOutcome("inconclusive", "worked")).toBe(false);
  });

  it("labels every outcome value", () => {
    expect(Object.keys(DECISION_OUTCOME_LABELS).sort()).toEqual([
      "did_not_work",
      "inconclusive",
      "pending",
      "worked",
    ]);
  });
});
