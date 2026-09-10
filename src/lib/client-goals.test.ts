import { describe, expect, it } from "vitest";
import { isGoalWindowActive, CLIENT_GOAL_STATUS_LABELS } from "./client-goals";

const goal = (start: string, end: string) => ({
  targetWindowStart: new Date(start),
  targetWindowEnd: new Date(end),
});

describe("isGoalWindowActive", () => {
  it("is true inside the window", () => {
    expect(
      isGoalWindowActive(goal("2026-01-01", "2026-03-01"), new Date("2026-02-01")),
    ).toBe(true);
  });

  it("is true on the exact boundaries (inclusive both ends)", () => {
    const g = goal("2026-01-01", "2026-03-01");
    expect(isGoalWindowActive(g, new Date("2026-01-01"))).toBe(true);
    expect(isGoalWindowActive(g, new Date("2026-03-01"))).toBe(true);
  });

  it("is false before and after", () => {
    const g = goal("2026-01-01", "2026-03-01");
    expect(isGoalWindowActive(g, new Date("2025-12-31"))).toBe(false);
    expect(isGoalWindowActive(g, new Date("2026-03-02"))).toBe(false);
  });
});

describe("CLIENT_GOAL_STATUS_LABELS", () => {
  it("labels every status value", () => {
    expect(Object.keys(CLIENT_GOAL_STATUS_LABELS).sort()).toEqual([
      "abandoned",
      "achieved",
      "active",
    ]);
  });
});
