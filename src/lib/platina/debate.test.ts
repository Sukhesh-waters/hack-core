import { describe, expect, it } from "vitest";
import { ONE_ROUND, nextRoundAllowed } from "./contradiction";
import { NO_MATERIAL_OBJECTION, parseAttack } from "./debate";

describe("debate round cap", () => {
  it("hard-codes a single contradiction round", () => {
    expect(ONE_ROUND).toBe(1);
    expect(nextRoundAllowed()).toBe(false);
  });
});

describe("parseAttack — the honest challenger (R5.1)", () => {
  it("maps an empty objection to the no-material-objection marker", () => {
    const attack = parseAttack(
      JSON.stringify({
        text: "the claim holds",
        confounders: [],
        strongestObjection: "",
        confounderStrength: 0.7,
      }),
    );
    expect(attack.strongestObjection).toBe(NO_MATERIAL_OBJECTION);
    // A non-attack carries zero confounder strength, whatever the model said.
    expect(attack.confounderStrength).toBe(0);
  });

  it("maps 'NONE' variants to the marker", () => {
    for (const objection of ["NONE", "None.", "no material objection"]) {
      expect(parseAttack(JSON.stringify({ strongestObjection: objection })).strongestObjection).toBe(
        NO_MATERIAL_OBJECTION,
      );
    }
  });

  it("keeps a real objection verbatim", () => {
    const attack = parseAttack(
      JSON.stringify({
        text: "the sample is from one region",
        confounders: ["seasonality"],
        strongestObjection: "single-region sample",
        confounderStrength: 0.6,
      }),
    );
    expect(attack.strongestObjection).toBe("single-region sample");
    expect(attack.confounderStrength).toBe(0.6);
  });
});
