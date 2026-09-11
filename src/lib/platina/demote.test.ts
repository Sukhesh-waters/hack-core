import { describe, expect, it } from "vitest";
import { applyDemotion, shouldDemote, slowLoopOverridesFast } from "./demote";

describe("slow-loop demotion", () => {
  const hypo = {
    id: "c1",
    topic: "method-validation",
    generation: 3,
    status: "active" as const,
  };

  it("demotes a contradicted Brain chunk at any generation", () => {
    expect(
      shouldDemote({ topic: "method-validation", worked: false }, hypo),
    ).toBe(true);
    expect(applyDemotion(hypo, { topic: "method-validation", worked: false }).status).toBe(
      "demoted",
    );
  });

  it("does not demote on a matching success", () => {
    expect(
      shouldDemote({ topic: "method-validation", worked: true }, hypo),
    ).toBe(false);
  });

  it("states that the slow loop overrides the fast loop", () => {
    expect(slowLoopOverridesFast()).toBe(true);
  });
});
