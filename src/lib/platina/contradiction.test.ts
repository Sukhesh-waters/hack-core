import { describe, expect, it } from "vitest";
import {
  CONTESTED_FLOOR,
  ONE_ROUND,
  nextRoundAllowed,
  resolve,
  resolveV2,
  type Attack,
  type Claim,
  type ResolveV2Input,
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

describe("resolveV2 (B3, owner decision D7)", () => {
  const v2input = (overrides: Partial<ResolveV2Input> = {}): ResolveV2Input => ({
    evidenceCoverage: 0.8,
    confounderStrength: 0.2,
    falsifierValid: true,
    strongestObjection: "seasonality confounder",
    ...overrides,
  });

  it("agrees on strong coverage with a weak confounder and a valid falsifier", () => {
    const result = resolveV2(v2input());
    expect(result.state).toBe("agreed");
    expect(result.score).toBeGreaterThanOrEqual(0.7);
  });

  it("qualifies in the middle, carrying the challenger's own objection as the caveat", () => {
    const result = resolveV2(v2input({ evidenceCoverage: 0.55, confounderStrength: 0.55 }));
    expect(["qualified", "agreed", "contested"]).toContain(result.state);
    if (result.state === "qualified") {
      expect(result.caveat).toBe("seasonality confounder");
    }
  });

  it("contests thin coverage against a real confounder", () => {
    const result = resolveV2(v2input({ evidenceCoverage: 0.15, confounderStrength: 0.7 }));
    expect(result.score).toBeLessThan(CONTESTED_FLOOR + 0.15);
    expect(["contested", "refuted", "qualified"]).toContain(result.state);
  });

  it("refutes near-zero coverage against a crushing confounder", () => {
    const result = resolveV2(v2input({ evidenceCoverage: 0.1, confounderStrength: 0.95 }));
    expect(result.state).toBe("refuted");
  });

  it("an invalid falsifier costs the same 0.2 share overlap did in v1 — never passing alone", () => {
    const withValid = resolveV2(v2input({ evidenceCoverage: 1, confounderStrength: 0, falsifierValid: true }));
    const withInvalid = resolveV2(v2input({ evidenceCoverage: 1, confounderStrength: 0, falsifierValid: false }));
    expect(withValid.score).toBeGreaterThan(withInvalid.score);
    expect(withValid.state).toBe("agreed");
  });

  it("is deterministic", () => {
    expect(resolveV2(v2input())).toEqual(resolveV2(v2input()));
  });

  it("respects workspace floors, same as resolve()", () => {
    const strict = resolveV2(v2input({ evidenceCoverage: 0.6, confounderStrength: 0.3 }), {
      qualifiedFloor: 0.95,
    });
    expect(strict.state).not.toBe("agreed");
  });

  it("is invariant to proposer confidence/specificity BY CONSTRUCTION — there is no parameter to read it from", () => {
    // ResolveV2Input simply has no `specificity`/`confidence` field, so two
    // inputs that would have mapped to wildly different v1 `Claim.specificity`
    // values (0.3 "low" vs 0.9 "high", via debate.ts's
    // TEMPORARY_CONFIDENCE_SPECIFICITY) produce the identical v2 score once
    // the OTHER three deterministic inputs are held equal.
    const sameInputsDifferentConfidenceContext = v2input();
    const a = resolveV2(sameInputsDifferentConfidenceContext);
    const b = resolveV2({ ...sameInputsDifferentConfidenceContext });
    expect(a).toEqual(b);
  });
});
