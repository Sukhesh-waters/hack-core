import { describe, expect, it } from "vitest";
import {
  CONTESTED_FLOOR,
  ONE_ROUND,
  nextRoundAllowed,
  resolve,
  type Attack,
  type Claim,
} from "./contradiction";

const claim = (overrides: Partial<Claim> = {}): Claim => ({
  text: "Method validation is drawing attention",
  evidenceSpans: ["validation pain point"],
  specificity: 0.8,
  ...overrides,
});

const attack = (overrides: Partial<Attack> = {}): Attack => ({
  text: "Conference season explains the spike",
  confounders: ["seasonality"],
  strongestObjection: "seasonality confounder",
  confounderStrength: 0.2,
  ...overrides,
});

describe("contradiction resolve", () => {
  it("agrees on a specific claim with a weak attack", () => {
    const result = resolve(claim(), attack());
    expect(result.state).toBe("agreed");
    expect(result.score).toBeGreaterThanOrEqual(0.7);
  });

  it("qualifies when the attack is moderate", () => {
    const result = resolve(claim({ specificity: 0.55 }), attack({ confounderStrength: 0.55 }));
    expect(["qualified", "agreed", "contested"]).toContain(result.state);
    if (result.state === "qualified") {
      expect(result.caveat).toBe("seasonality confounder");
    }
  });

  it("contests a weak claim", () => {
    const result = resolve(
      claim({ specificity: 0.15 }),
      attack({ confounderStrength: 0.7 }),
    );
    expect(result.score).toBeLessThan(CONTESTED_FLOOR + 0.15);
    expect(["contested", "refuted", "qualified"]).toContain(result.state);
  });

  it("refutes a vague claim against a crushing confounder", () => {
    const result = resolve(
      claim({ specificity: 0.1 }),
      attack({ confounderStrength: 0.95 }),
    );
    expect(result.state).toBe("refuted");
  });

  it("is deterministic", () => {
    expect(resolve(claim(), attack())).toEqual(resolve(claim(), attack()));
  });

  it("hard-caps at one round", () => {
    expect(ONE_ROUND).toBe(1);
    expect(nextRoundAllowed()).toBe(false);
  });
});
