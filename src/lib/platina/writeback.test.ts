import { describe, expect, it } from "vitest";
import {
  DEMOTED_CONFIDENCE_FLOOR,
  demotedConfidence,
  gradingWriteback,
} from "./writeback";

const receipt = {
  id: "rec-1",
  title: "ASMS follow-up",
  hypothesis: "validation pain converts",
  expectedOutcome: "20 qualified leads",
  evidenceBrainIds: ["br-1", "br-2"],
};

describe("gradingWriteback", () => {
  it("every verdict writes a first-party evidence record", () => {
    for (const outcome of ["worked", "did_not_work", "inconclusive"] as const) {
      const plan = gradingWriteback(receipt, outcome, "CRM import");
      expect(plan.evidenceContent).toContain("Measured outcome");
      expect(plan.evidenceContent).toContain("validation pain converts");
      expect(plan.evidenceContent).toContain("CRM import");
    }
  });

  it("did_not_work demotes the receipt's linked hypotheses", () => {
    const plan = gradingWriteback(receipt, "did_not_work", undefined);
    expect(plan.demoteBrainChunkIds).toEqual(["br-1", "br-2"]);
  });

  it("worked and inconclusive demote nothing", () => {
    expect(gradingWriteback(receipt, "worked", undefined).demoteBrainChunkIds).toEqual([]);
    expect(
      gradingWriteback(receipt, "inconclusive", undefined).demoteBrainChunkIds,
    ).toEqual([]);
  });

  it("demotion floors confidence but retains the record (R5.3)", () => {
    expect(demotedConfidence(0.9)).toBe(DEMOTED_CONFIDENCE_FLOOR);
    expect(demotedConfidence(0.1)).toBe(0.1);
  });
});
