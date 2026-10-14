import { describe, expect, it } from "vitest";
import { FALSIFIER_METRICS } from "@/lib/platina/falsifier-metrics";
import {
  PLAN_FALSIFIER_METRICS,
  describePlanFalsifier,
  parsePlanFalsifier,
  planFalsifierInstruction,
} from "./falsifier";

describe("parsePlanFalsifier", () => {
  it("accepts a registry metric, direction, threshold and declared window", () => {
    expect(parsePlanFalsifier({ metric: "creative_leads", direction: "below", threshold: 10, window_days: 30 })).toEqual({
      metric: "creative_leads",
      direction: "below",
      threshold: 10,
      window_days: 30,
    });
  });

  it("coerces a numeric string threshold and window", () => {
    expect(parsePlanFalsifier({ metric: "creative_ctr", direction: "below", threshold: "0.02", window_days: "90" })).toMatchObject({
      threshold: 0.02,
      window_days: 90,
    });
  });

  it.each([
    ["null", null],
    ["a string", "leads below 10"],
    ["a metric the planner may not use", { metric: "topic_momentum", direction: "below", threshold: 1, window_days: 30 }],
    ["an invented metric", { metric: "revenue", direction: "below", threshold: 1, window_days: 30 }],
    ["a bad direction", { metric: "creative_leads", direction: "under", threshold: 10, window_days: 30 }],
    ["a negative threshold", { metric: "creative_leads", direction: "below", threshold: -1, window_days: 30 }],
    ["a non-numeric threshold", { metric: "creative_leads", direction: "below", threshold: "ten", window_days: 30 }],
    ["an undeclared window", { metric: "creative_leads", direction: "below", threshold: 10, window_days: 45 }],
  ])("drops %s", (_label, raw) => {
    expect(parsePlanFalsifier(raw)).toBeNull();
  });
});

describe("planFalsifierInstruction", () => {
  it("lists only the plan metrics, with windows taken from the registry", () => {
    const text = planFalsifierInstruction();
    for (const id of Object.keys(PLAN_FALSIFIER_METRICS)) {
      expect(text).toContain(`"${id}"`);
      expect(text).toContain(FALSIFIER_METRICS[id as keyof typeof FALSIFIER_METRICS].windows.join(" or "));
    }
    expect(text).not.toContain("topic_momentum");
  });
});

describe("describePlanFalsifier", () => {
  it("reads as one plain sentence, rates as percentages", () => {
    expect(describePlanFalsifier({ metric: "creative_leads", direction: "below", threshold: 10, window_days: 30 })).toBe(
      "This plan is not working if leads from this plan's pieces are below 10 after 30 days.",
    );
    expect(describePlanFalsifier({ metric: "creative_ctr", direction: "below", threshold: 0.015, window_days: 90 })).toBe(
      "This plan is not working if click-through rate on this plan's pieces is below 1.5% after 90 days.",
    );
  });

  it("never uses internal vocabulary", () => {
    const text = describePlanFalsifier({ metric: "creative_engagement_rate", direction: "below", threshold: 2, window_days: 30 });
    expect(text.toLowerCase()).not.toMatch(/falsifier|registry|creative_/);
  });
});
