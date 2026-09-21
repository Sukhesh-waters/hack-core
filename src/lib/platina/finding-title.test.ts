import { describe, expect, it } from "vitest";
import { MAX_TITLE, UNNAMED, findingTitleFor, firstSentence } from "./finding-title";

describe("firstSentence", () => {
  it("takes the first sentence", () => {
    expect(firstSentence("Bluebird added a guarantee. It runs to December.")).toBe(
      "Bluebird added a guarantee",
    );
  });

  it("cuts a long clause on a word boundary and marks the cut", () => {
    const out = firstSentence(
      "Bluebird has introduced an extremely long and rambling description of a roasting guarantee that never reaches a full stop",
      60,
    );
    expect(out.length).toBeLessThanOrEqual(61);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });

  it("returns empty for empty input", () => {
    expect(firstSentence("   ")).toBe("");
  });
});

describe("findingTitleFor", () => {
  const base = {
    headline: null as string | null,
    competitorName: "Bluebird Roasters",
    claimText: "Bluebird now guarantees delivery within 48 hours of roasting.",
    pageTitle: "Contact sales",
  };

  it("prefers the model's headline", () => {
    expect(
      findingTitleFor({ ...base, headline: "Bluebird guarantees a 48-hour roast" }),
    ).toBe("Bluebird guarantees a 48-hour roast");
  });

  it("prefixes the competitor when the headline does not name it", () => {
    expect(findingTitleFor({ ...base, headline: "New 48-hour delivery promise" })).toBe(
      "Bluebird Roasters: New 48-hour delivery promise",
    );
  });

  it("falls back to the claim, never to the page title, when a claim exists", () => {
    const title = findingTitleFor(base);
    expect(title).toContain("48 hours");
    expect(title).not.toContain("Contact sales");
  });

  it("uses the page title only when there is nothing else", () => {
    expect(findingTitleFor({ ...base, claimText: "" })).toBe(
      "Bluebird Roasters: Contact sales",
    );
  });

  it("never returns an empty title", () => {
    expect(
      findingTitleFor({ headline: null, competitorName: null, claimText: "", pageTitle: null }),
    ).toBe(UNNAMED);
  });

  it("works without a competitor name", () => {
    expect(
      findingTitleFor({ ...base, competitorName: null, headline: "A new guarantee" }),
    ).toBe("A new guarantee");
  });

  it("bounds the length", () => {
    expect(
      findingTitleFor({ ...base, headline: "x".repeat(400) }).length,
    ).toBeLessThanOrEqual(MAX_TITLE);
  });

  it("does not double-name a competitor whose first word already appears", () => {
    expect(findingTitleFor({ ...base, headline: "Bluebird cuts prices" })).toBe(
      "Bluebird cuts prices",
    );
  });
});
