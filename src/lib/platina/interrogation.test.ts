/**
 * B1 — interrogation schema + falsifier. Direct unit coverage for the pure
 * parse/validate pair (plan §5 B1): the validator rejection table, id
 * checking against a real span map, the "nothing new" cheap exit, and the
 * rule that a parse failure is invalid and never salvaged into a claim.
 */
import { describe, expect, it } from "vitest";
import { FALSIFIER_METRICS } from "./falsifier-metrics";
import {
  INTERROGATION_SYSTEM,
  TEMPORARY_CONFIDENCE_SPECIFICITY,
  chunkDirectionFor,
  metricListText,
  parseInterrogation,
  validateInterrogation,
  type Interrogation,
} from "./interrogation";

const spans = {
  e1: "Acme launched a new assay this week.",
  e2: "The post drew 3.2x the usual engagement.",
};

const validClaim: Interrogation = {
  headline: "Acme launches a new assay",
  what: "Acme's new assay is drawing unusually high engagement.",
  why: ["e1", "e2"],
  how: "A launch post performing 3.2x normal engagement signals real market interest, not noise.",
  kind: "claim",
  falsifier: { metric: "topic_momentum", subject: { topic: "assay" }, direction: "below", threshold: 1.0, window_days: 30 },
  confidence: "medium",
};

const validFact: Interrogation = {
  headline: "Acme launches a new assay",
  what: "Acme launched a new assay this week.",
  why: ["e1"],
  how: "The page states this directly.",
  kind: "fact",
  falsifier: null,
  confidence: "high",
  quote: "Acme launched a new assay this week.",
};

describe("metricListText (B1 — generated from the registry, never hand-copied)", () => {
  it("lists every registry metric id and its windows", () => {
    const text = metricListText();
    for (const def of Object.values(FALSIFIER_METRICS)) {
      expect(text).toContain(def.id);
      expect(text).toContain(def.windows.join(" or "));
    }
  });

  it("INTERROGATION_SYSTEM embeds that same generated text, not a hand-copied list", () => {
    expect(INTERROGATION_SYSTEM).toContain(metricListText());
  });
});

describe("parseInterrogation", () => {
  it("parses a well-formed claim reply", () => {
    const parsed = parseInterrogation(JSON.stringify(validClaim));
    expect(parsed).toEqual(validClaim);
  });

  it("parses a well-formed fact reply, quote included", () => {
    const parsed = parseInterrogation(JSON.stringify(validFact));
    expect(parsed?.quote).toBe(validFact.quote);
  });

  it("is invalid (null), never salvaged, when the reply is not JSON at all", () => {
    expect(parseInterrogation("I think the competitor is doing something new.")).toBeNull();
  });

  it("is invalid when required fields (what/kind/confidence) are missing", () => {
    expect(parseInterrogation(JSON.stringify({ headline: "x" }))).toBeNull();
    expect(parseInterrogation(JSON.stringify({ what: "x", kind: "claim" }))).toBeNull();
    expect(parseInterrogation(JSON.stringify({ what: "x", confidence: "low" }))).toBeNull();
  });

  it("falls back to `what` for a missing headline rather than failing the whole parse", () => {
    const parsed = parseInterrogation(
      JSON.stringify({ what: "nothing new", kind: "claim", confidence: "low" }),
    );
    expect(parsed?.headline).toBe("nothing new");
  });
});

describe("validateInterrogation — the rejection table", () => {
  it("accepts a valid claim", () => {
    expect(validateInterrogation(validClaim, spans)).toEqual({ ok: true, value: validClaim });
  });

  it("accepts a valid fact", () => {
    expect(validateInterrogation(validFact, spans)).toEqual({ ok: true, value: validFact });
  });

  it("'nothing new' is a valid cheap exit, bypassing why/falsifier/quote entirely", () => {
    const nothingNew: Interrogation = {
      headline: "nothing new",
      what: "nothing new",
      why: [],
      how: "",
      kind: "claim",
      falsifier: null,
      confidence: "low",
    };
    expect(validateInterrogation(nothingNew, spans)).toEqual({ ok: true, value: nothingNew });
    expect(validateInterrogation({ ...nothingNew, what: "Nothing new." }, spans).ok).toBe(true);
  });

  it("a parse failure (null) is invalid, never salvaged", () => {
    const result = validateInterrogation(null, spans);
    expect(result.ok).toBe(false);
  });

  it("rejects empty why", () => {
    const result = validateInterrogation({ ...validClaim, why: [] }, spans);
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("cites no evidence") });
  });

  it("rejects an id that is not in the span map", () => {
    const result = validateInterrogation({ ...validClaim, why: ["e99"] }, spans);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("e99");
  });

  it("rejects more than one sentence", () => {
    const result = validateInterrogation(
      { ...validClaim, what: "Acme's assay is popular. It will likely keep growing." },
      spans,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a `what` longer than 220 characters", () => {
    const result = validateInterrogation({ ...validClaim, what: "x".repeat(221) }, spans);
    expect(result.ok).toBe(false);
  });

  it.each(["may", "might", "could", "possibly"])("rejects a hedge word (%s)", (hedge) => {
    const result = validateInterrogation({ ...validClaim, what: `Acme ${hedge} be gaining traction` }, spans);
    expect(result.ok).toBe(false);
  });

  it("rejects a claim with no falsifier", () => {
    const result = validateInterrogation({ ...validClaim, falsifier: null }, spans);
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("needs a falsifier") });
  });

  it("rejects a claim whose falsifier metric is not in the registry", () => {
    const result = validateInterrogation(
      { ...validClaim, falsifier: { ...validClaim.falsifier!, metric: "not_a_metric" as never } },
      spans,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a claim whose falsifier window the metric does not declare", () => {
    const result = validateInterrogation(
      { ...validClaim, falsifier: { ...validClaim.falsifier!, window_days: 90 } },
      spans,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a claim whose subject does not resolve, when a resolver is injected", () => {
    const result = validateInterrogation(validClaim, spans, { resolvesSubjectKey: () => false });
    expect(result.ok).toBe(false);
  });

  it("rejects a fact with no quote", () => {
    const result = validateInterrogation({ ...validFact, quote: undefined }, spans);
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("needs a quoted source") });
  });

  it("rejects a fact whose quote is not verbatim in any cited span (whitespace/case aside)", () => {
    const result = validateInterrogation({ ...validFact, quote: "Acme invented teleportation" }, spans);
    expect(result.ok).toBe(false);
  });

  it("accepts a fact's quote matched whitespace/case-insensitively against a cited span", () => {
    const result = validateInterrogation({ ...validFact, quote: "  ACME launched a new ASSAY this week " }, spans);
    expect(result.ok).toBe(true);
  });
});

describe("chunkDirectionFor (B1 — the claim's own direction, not the falsifier's trigger direction)", () => {
  it("below-triggered falsifier means the claim asserts 'up'", () => {
    expect(chunkDirectionFor({ metric: "topic_momentum", subject: {}, direction: "below", threshold: 1, window_days: 30 })).toBe("up");
  });

  it("above-triggered falsifier means the claim asserts 'down'", () => {
    expect(chunkDirectionFor({ metric: "topic_momentum", subject: {}, direction: "above", threshold: 1, window_days: 30 })).toBe("down");
  });

  it("no falsifier (a fact) has no direction", () => {
    expect(chunkDirectionFor(null)).toBe("none");
  });
});

describe("TEMPORARY_CONFIDENCE_SPECIFICITY (D7 — labelled temporary)", () => {
  it("maps low/medium/high to the documented 0.3/0.6/0.9", () => {
    expect(TEMPORARY_CONFIDENCE_SPECIFICITY).toEqual({ low: 0.3, medium: 0.6, high: 0.9 });
  });
});
