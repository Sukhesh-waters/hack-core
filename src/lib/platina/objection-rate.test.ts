import { describe, expect, it } from "vitest";
import {
  objectionCeilingExceeded,
  objectionRate,
} from "./objection-rate";

const rounds = (state: "agreed" | "contested" | "refuted", n: number) =>
  Array.from({ length: n }, () => ({ state }));

describe("objectionRate", () => {
  it("is zero with no rounds", () => {
    expect(objectionRate([])).toBe(0);
  });

  it("counts contested and refuted as objections", () => {
    const mix = [
      ...rounds("agreed", 6),
      ...rounds("contested", 3),
      ...rounds("refuted", 1),
    ];
    expect(objectionRate(mix)).toBe(0.4);
  });
});

describe("objectionCeilingExceeded", () => {
  it("never alarms below the minimum window", () => {
    expect(objectionCeilingExceeded(rounds("contested", 9))).toBe(false);
    expect(objectionCeilingExceeded(rounds("refuted", 2))).toBe(false);
  });

  it("alarms at or above the ceiling with enough rounds", () => {
    expect(objectionCeilingExceeded(rounds("contested", 10))).toBe(true);
    const atCeiling = [...rounds("contested", 8), ...rounds("agreed", 2)];
    expect(objectionCeilingExceeded(atCeiling)).toBe(true);
  });

  it("stays quiet below the ceiling", () => {
    const below = [...rounds("contested", 7), ...rounds("agreed", 3)];
    expect(objectionCeilingExceeded(below)).toBe(false);
  });
});
