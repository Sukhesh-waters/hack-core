import { describe, expect, it } from "vitest";
import { computeCascade, addBusinessDays, type CascadeStepLike } from "./cascade";

describe("cascade calculation engine", () => {
  it("skips weekends when adding business days", () => {
    // Friday
    const friday = new Date("2026-08-21T00:00:00.000Z");
    // +1 business day = Monday (Aug 24)
    const monday = addBusinessDays(friday, 1);
    expect(monday.getDay()).toBe(1); // Monday
    expect(monday.toISOString().slice(0, 10)).toBe("2026-08-24");
  });

  it("calculates forward dependency moves when a step slips", () => {
    const steps: CascadeStepLike[] = [
      {
        id: "step-1",
        title: "Briefing",
        dueAt: new Date("2026-08-10T00:00:00.000Z"),
        status: "in_progress",
        dependsOn: [],
        assigneeId: "user-1",
      },
      {
        id: "step-2",
        title: "Design",
        dueAt: new Date("2026-08-12T00:00:00.000Z"),
        status: "blocked",
        dependsOn: ["step-1"],
        assigneeId: "user-2",
      },
      {
        id: "step-3",
        title: "Client Review",
        dueAt: new Date("2026-08-15T00:00:00.000Z"),
        status: "blocked",
        dependsOn: ["step-2"],
        assigneeId: "user-3",
      },
    ];

    // step-1 completed on Aug 12 (+2 days slip)
    const actual = new Date("2026-08-12T00:00:00.000Z");
    const result = computeCascade({
      steps,
      slippedStepId: "step-1",
      actualCompletionDate: actual,
    });

    expect(result.slipDays).toBe(2);
    expect(result.moves).toHaveLength(2);
    expect(result.moves[0].stepId).toBe("step-2");
    expect(result.moves[1].stepId).toBe("step-3");
    expect(result.scopedRunHash).toBeDefined();
  });

  it("returns no moves if completed on time", () => {
    const steps: CascadeStepLike[] = [
      {
        id: "step-1",
        title: "Briefing",
        dueAt: new Date("2026-08-10T00:00:00.000Z"),
        status: "in_progress",
        dependsOn: [],
        assigneeId: "user-1",
      },
    ];

    const result = computeCascade({
      steps,
      slippedStepId: "step-1",
      actualCompletionDate: new Date("2026-08-09T00:00:00.000Z"),
    });

    expect(result.slipDays).toBe(0);
    expect(result.moves).toHaveLength(0);
  });
});
