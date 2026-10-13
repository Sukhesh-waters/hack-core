import { describe, expect, it } from "vitest";
import { ONE_ROUND, nextRoundAllowed } from "./contradiction";
import {
  ANALYSIS_PROMPT_VERSION,
  CHALLENGER_SYSTEM,
  NO_MATERIAL_OBJECTION,
  NOTHING_NEW,
  PROPOSER_SYSTEM,
  isNothingNew,
  parseAttack,
  parseHeadline,
} from "./debate";

describe("ANALYSIS_PROMPT_VERSION (B0 provenance)", () => {
  it("is a non-empty, stable version tag stored on every transcript", () => {
    expect(ANALYSIS_PROMPT_VERSION).toBe("analysis-v1");
  });
});

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

describe("parseHeadline / isNothingNew (R2)", () => {
  it("takes the model's own naming of the move", () => {
    expect(
      parseHeadline(JSON.stringify({ headline: "Bluebird now guarantees a 48-hour roast" })),
    ).toBe("Bluebird now guarantees a 48-hour roast");
  });

  it("returns null for a missing, empty or unparseable headline", () => {
    expect(parseHeadline(JSON.stringify({ text: "x" }))).toBeNull();
    expect(parseHeadline(JSON.stringify({ headline: "   " }))).toBeNull();
    expect(parseHeadline("not json at all")).toBeNull();
    expect(parseHeadline(JSON.stringify({ headline: 42 }))).toBeNull();
  });

  it("bounds a runaway headline instead of storing an essay as a title", () => {
    expect(parseHeadline(JSON.stringify({ headline: "x".repeat(400) }))!.length).toBe(120);
  });

  it("recognises the honest 'nothing new' answer in the forms a model writes it", () => {
    for (const headline of ["nothing new", "Nothing new", "nothing new."]) {
      expect(isNothingNew(headline)).toBe(true);
    }
    expect(isNothingNew("Bluebird launches nothing new pricing")).toBe(false);
    expect(isNothingNew(null)).toBe(false);
  });
});

describe("the prompts state the rules the output depends on", () => {
  it("asks the proposer for a headline, novelty and the client angle", () => {
    expect(PROPOSER_SYSTEM).toContain("headline");
    expect(PROPOSER_SYSTEM).toContain("NEW");
    expect(PROPOSER_SYSTEM).toContain("client");
    expect(PROPOSER_SYSTEM).toContain(NOTHING_NEW);
    // The defect this round exists to kill.
    expect(PROPOSER_SYSTEM).toMatch(/do not summarise or restate/i);
  });

  it("asks the challenger to call out generic claims by name", () => {
    expect(CHALLENGER_SYSTEM).toMatch(/ordinary marketing copy/i);
    expect(CHALLENGER_SYSTEM).toContain("confounderStrength");
  });
});
