import { describe, expect, it } from "vitest";
import { claimsGate } from "./claims-gate";

describe("claimsGate", () => {
  it("passes clean copy", () => {
    const result = claimsGate({
      contentPlan: "Accurate, reproducible chromatography results.",
      taskTitles: ["Finalize messaging"],
      hasException: false,
    });
    expect(result.verdict).toBe("passed");
    expect(result.blocksApproval).toBe(false);
  });

  it("a deterministic violation blocks approval without an exception", () => {
    const result = claimsGate({
      contentPlan: "Our system is guaranteed to pass every audit.",
      taskTitles: [],
      hasException: false,
    });
    expect(result.verdict).toBe("flagged");
    expect(result.blocksApproval).toBe(true);
  });

  it("a named-approver exception unblocks — but the violation stays visible", () => {
    const result = claimsGate({
      contentPlan: "Clinically proven performance.",
      taskTitles: [],
      hasException: true,
    });
    expect(result.verdict).toBe("flagged");
    expect(result.excepted).toBe(true);
    expect(result.blocksApproval).toBe(false);
  });

  it("task titles are screened too", () => {
    const result = claimsGate({
      contentPlan: null,
      taskTitles: ["Publish the cure claim"],
      hasException: false,
    });
    expect(result.blocksApproval).toBe(true);
  });
});
