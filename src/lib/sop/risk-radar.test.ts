import { describe, expect, it } from "vitest";
import { evaluateSopRiskRadar, evaluateSopStaleness } from "./risk-radar";

describe("evaluateSopRiskRadar", () => {
  it("flags on_track for runs without overdue steps", () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const res = evaluateSopRiskRadar([
      { id: "s1", status: "ready", dueAt: tomorrow, dependsOn: [] },
      { id: "s2", status: "blocked", dueAt: tomorrow, dependsOn: ["s1"] },
    ]);

    expect(res.riskLevel).toBe("on_track");
    expect(res.riskScore).toBe(0);
    expect(res.overdueStepIds).toHaveLength(0);
  });

  it("identifies critical bottlenecks when upstream steps are severely late", () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const res = evaluateSopRiskRadar([
      { id: "s1", status: "ready", dueAt: fourDaysAgo, dependsOn: [] },
      { id: "s2", status: "blocked", dueAt: tomorrow, dependsOn: ["s1"] },
    ]);

    expect(res.riskLevel).toBe("critical");
    expect(res.bottleneckStepId).toBe("s1");
    expect(res.overdueStepIds).toEqual(["s1"]);
    expect(res.atRiskStepIds).toEqual(["s2"]);
  });
});

describe("evaluateSopStaleness", () => {
  it("marks empty templates as stale", () => {
    const res = evaluateSopStaleness({
      templateId: "t1",
      stepCount: 0,
      lastRunAt: null,
    });
    expect(res.isStale).toBe(true);
  });

  it("marks templates without recent runs (>90d) as stale", () => {
    const hundredDaysAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    const res = evaluateSopStaleness({
      templateId: "t2",
      stepCount: 5,
      lastRunAt: hundredDaysAgo,
      maxInactiveDays: 90,
    });
    expect(res.isStale).toBe(true);
    expect(res.daysInactive).toBe(100);
  });

  it("marks active templates as not stale", () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const res = evaluateSopStaleness({
      templateId: "t3",
      stepCount: 4,
      lastRunAt: fiveDaysAgo,
    });
    expect(res.isStale).toBe(false);
  });
});
