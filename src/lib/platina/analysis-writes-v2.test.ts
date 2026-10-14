/**
 * B1 — analysisWrites's v2 (interrogation) path. Separate from
 * brain-legacy-equivalence.test.ts on purpose (plan §5 B1: "do NOT
 * regenerate the legacy fixture JSON" — that file proves mode="off" is
 * byte-identical; this file is new fixtures for the 4th, `v2`, argument,
 * which the golden test and analysis-writes.test.ts never pass).
 */
import { describe, expect, it } from "vitest";
import type { AnalysisPlan } from "./analysis-plan";
import {
  UNTESTABLE_SKIP_CAUSE,
  analysisWrites,
  type AnalysisWritesV2Input,
  type DebateOutcome,
} from "./analysis-writes";
import type { Interrogation } from "./interrogation";

const context = { competitorName: "Bluebird Roasters", pageTitle: "Roast guarantee", sourceKind: "competitor_site" };
const plan: AnalysisPlan = { action: "analyse", input: "x", changed: false };
const now = new Date("2026-10-13T00:00:00Z");

const validClaim: Interrogation = {
  headline: "Bluebird now guarantees a 48-hour roast",
  what: "Bluebird now guarantees a 48-hour roast turnaround.",
  why: ["e1"],
  how: "A faster guarantee than the industry standard signals a capacity investment.",
  kind: "claim",
  falsifier: { metric: "topic_momentum", subject: { topic: "roast speed" }, direction: "below", threshold: 1.0, window_days: 30 },
  confidence: "medium",
};

const validFact: Interrogation = {
  ...validClaim,
  kind: "fact",
  falsifier: null,
  quote: "48-hour roast guarantee",
};

const agreedDebate: DebateOutcome = {
  claim: { text: validClaim.what, evidenceSpans: ["48-hour roast guarantee"], specificity: 0.6 },
  attack: { text: "No material defect found.", confounders: [], strongestObjection: "no material objection", confounderStrength: 0 },
  result: { state: "agreed", score: 0.9 },
  headline: validClaim.headline,
  nothingNew: false,
};

function v2For(opts: Partial<AnalysisWritesV2Input>): AnalysisWritesV2Input {
  return {
    mode: "shadow",
    interrogation: { ok: true, value: validClaim },
    parsed: validClaim,
    signalDocumentId: "sig_1",
    now,
    promptVersion: "analysis-v2",
    writtenBy: "interrogation-v1",
    ...opts,
  };
}

describe("analysisWrites — v2 omitted (unaffected)", () => {
  it("is identical to the 3-arg call when v2 is not passed", () => {
    expect(analysisWrites(plan, agreedDebate, context)).toEqual(analysisWrites(plan, agreedDebate, context, undefined));
  });
});

describe("analysisWrites — v2, a valid claim (shadow or on)", () => {
  for (const mode of ["shadow", "on"] as const) {
    it(`mode=${mode}: the Brain chunk carries kind/mechanism/evidenceRefs/falsifier/subjectKey/direction/dueAt, grade_state 'untested'`, () => {
      const writes = analysisWrites(plan, agreedDebate, context, v2For({ mode }));
      expect(writes.skip).toBeUndefined();
      expect(writes.brainChunk).toMatchObject({
        kind: "claim",
        mechanism: validClaim.how,
        evidenceRefs: ["sig:sig_1#e1"],
        falsifier: validClaim.falsifier,
        subjectKey: "topic:roast speed",
        direction: "up", // falsifier.direction "below" -> claim asserts "up"
        gradeState: "untested",
        promptVersion: "analysis-v2",
        writtenBy: "interrogation-v1",
      });
      expect(writes.brainChunk?.dueAt).toEqual(new Date(now.getTime() + 30 * 86_400_000));
    });
  }

  it("kind='fact' never carries a falsifier, even if the model attached one; direction is 'none'", () => {
    const writes = analysisWrites(
      plan,
      agreedDebate,
      context,
      v2For({ interrogation: { ok: true, value: validFact }, parsed: validFact }),
    );
    expect(writes.brainChunk?.kind).toBe("fact");
    expect(writes.brainChunk?.falsifier).toBeNull();
    expect(writes.brainChunk?.direction).toBe("none");
    expect(writes.brainChunk?.dueAt).toBeNull();
  });
});

describe("analysisWrites — v2, an INVALID interrogation", () => {
  const invalid = { ok: false as const, reason: "The claim could not be tested: it cites no evidence from the input." };

  it("mode=shadow: still written (same debate-state path as today), but grade_state 'insufficient'", () => {
    const writes = analysisWrites(
      plan,
      agreedDebate,
      context,
      v2For({ mode: "shadow", interrogation: invalid, parsed: validClaim }),
    );
    expect(writes.skip).toBeUndefined();
    expect(writes.brainChunk).toBeDefined();
    expect(writes.brainChunk?.gradeState).toBe("insufficient");
    // Best-effort fields still come from the parse, even though it failed validation.
    expect(writes.brainChunk?.kind).toBe("claim");
    expect(writes.brainChunk?.mechanism).toBe(validClaim.how);
  });

  it("mode=on: skipped with cause 'untestable' and the validator's own reason — no Brain chunk, no finding", () => {
    const writes = analysisWrites(
      plan,
      agreedDebate,
      context,
      v2For({ mode: "on", interrogation: invalid, parsed: validClaim }),
    );
    expect(writes.skip).toEqual({ reason: invalid.reason, cause: UNTESTABLE_SKIP_CAUSE });
    expect(writes.processed).toBe(false);
    expect(writes.brainChunk).toBeUndefined();
    expect(writes.finding).toBeUndefined();
    // The transcript is still produced — the audit trail survives a reject.
    expect(writes.transcript).toBeDefined();
  });

  it("mode=on + invalid overrides even a state that would otherwise earn a chunk (agreed)", () => {
    const writes = analysisWrites(
      plan,
      { ...agreedDebate, result: { state: "agreed", score: 0.95 } },
      context,
      v2For({ mode: "on", interrogation: invalid, parsed: validClaim }),
    );
    expect(writes.skip?.cause).toBe(UNTESTABLE_SKIP_CAUSE);
  });

  it("mode=on + valid interrogation falls through to the ordinary nothing_new skip untouched", () => {
    const nothingNewDebate: DebateOutcome = { ...agreedDebate, headline: "nothing new", nothingNew: true };
    const writes = analysisWrites(
      { ...plan, changed: false },
      nothingNewDebate,
      context,
      v2For({ mode: "on", interrogation: { ok: true, value: validClaim } }),
    );
    expect(writes.skip?.cause).toBe("nothing_new");
  });
});
