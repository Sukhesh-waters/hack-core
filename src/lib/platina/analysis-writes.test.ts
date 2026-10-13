/**
 * Direct unit coverage for the pure write decision (B0). The broader
 * behavioural proof — that this matches what `main` wrote before the B0
 * refactor — lives in brain-legacy-equivalence.test.ts; this file covers the
 * contract analysisWrites exposes on its own (the required-debate guard, and
 * that a skip never needs one).
 */
import { describe, expect, it } from "vitest";
import type { AnalysisPlan } from "./analysis-plan";
import { analysisWrites, NOTHING_NEW_SKIP_REASON, type DebateOutcome } from "./analysis-writes";

const context = { competitorName: "Bluebird Roasters", pageTitle: "Roast guarantee", sourceKind: "competitor_site" };

const agreedDebate: DebateOutcome = {
  claim: { text: "Bluebird now guarantees a 48-hour roast.", evidenceSpans: [], specificity: 0.8 },
  attack: { text: "No material defect found.", confounders: [], strongestObjection: "no material objection", confounderStrength: 0 },
  result: { state: "agreed", score: 0.9 },
  headline: "Bluebird now guarantees a 48-hour roast",
  nothingNew: false,
};

describe("analysisWrites", () => {
  it("own_brand: processed, no skip row, no debate needed", () => {
    const plan: AnalysisPlan = { action: "skip", reason: "own page", cause: "own_brand" };
    expect(analysisWrites(plan, undefined, context)).toEqual({ processed: true });
  });

  it("low_value: a skip row with the plan's own reason and cause, no debate needed", () => {
    const plan: AnalysisPlan = { action: "skip", reason: "too thin", cause: "low_value" };
    expect(analysisWrites(plan, undefined, context)).toEqual({
      skip: { reason: "too thin", cause: "low_value" },
      processed: false,
    });
  });

  it("throws if a surviving plan is analysed without a debate outcome — never silently salvaged", () => {
    const plan: AnalysisPlan = { action: "analyse", input: "x", changed: false };
    expect(() => analysisWrites(plan, undefined, context)).toThrow(/debate outcome is required/);
  });

  it("nothing-new + unchanged page: transcript kept, skipped with the fixed reason and cause", () => {
    const plan: AnalysisPlan = { action: "analyse", input: "x", changed: false };
    const debate: DebateOutcome = { ...agreedDebate, headline: "nothing new", nothingNew: true };
    const writes = analysisWrites(plan, debate, context);
    expect(writes.skip).toEqual({ reason: NOTHING_NEW_SKIP_REASON, cause: "nothing_new" });
    expect(writes.processed).toBe(false);
    expect(writes.transcript).toBeDefined();
    expect(writes.brainChunk).toBeUndefined();
    expect(writes.finding).toBeUndefined();
  });

  it("nothing-new + CHANGED page: the flag is ignored, the debate state decides the write", () => {
    const plan: AnalysisPlan = { action: "analyse", input: "x", changed: true };
    const debate: DebateOutcome = { ...agreedDebate, headline: "nothing new", nothingNew: true };
    const writes = analysisWrites(plan, debate, context);
    expect(writes.skip).toBeUndefined();
    expect(writes.processed).toBe(true);
    expect(writes.brainChunk).toBeDefined();
    expect(writes.finding).toBeDefined();
  });

  it("agreed: finding status 'new', brain chunk content has no caveat suffix", () => {
    const plan: AnalysisPlan = { action: "analyse", input: "x", changed: false };
    const writes = analysisWrites(plan, agreedDebate, context);
    expect(writes.brainChunk?.content).toBe(agreedDebate.claim.text);
    expect(writes.finding?.status).toBe("new");
  });

  it("qualified: brain chunk content carries the caveat suffix; the finding's objection IS the caveat", () => {
    const plan: AnalysisPlan = { action: "analyse", input: "x", changed: false };
    const debate: DebateOutcome = {
      ...agreedDebate,
      result: { state: "qualified", score: 0.6, caveat: "thin sample" },
    };
    const writes = analysisWrites(plan, debate, context);
    expect(writes.brainChunk?.content).toBe(`${agreedDebate.claim.text}\nCaveat: thin sample`);
    expect(writes.finding?.strongestObjection).toBe("thin sample");
  });

  it("contested: a finding awaiting a human, no Brain chunk", () => {
    const plan: AnalysisPlan = { action: "analyse", input: "x", changed: false };
    const debate: DebateOutcome = { ...agreedDebate, result: { state: "contested", score: 0.2 } };
    const writes = analysisWrites(plan, debate, context);
    expect(writes.brainChunk).toBeUndefined();
    expect(writes.finding?.status).toBe("needs_decision");
  });

  it("refuted: neither a finding nor a Brain chunk, but the transcript and processed=true survive", () => {
    const plan: AnalysisPlan = { action: "analyse", input: "x", changed: false };
    const debate: DebateOutcome = { ...agreedDebate, result: { state: "refuted", score: 0.05 } };
    const writes = analysisWrites(plan, debate, context);
    expect(writes.brainChunk).toBeUndefined();
    expect(writes.finding).toBeUndefined();
    expect(writes.transcript).toBeDefined();
    expect(writes.processed).toBe(true);
  });
});
