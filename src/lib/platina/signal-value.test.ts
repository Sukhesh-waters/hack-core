import { describe, expect, it } from "vitest";
import {
  MIN_PROSE_CHARS,
  boilerplateReason,
  navigationRatio,
  scoreSignal,
} from "./signal-value";

const prose = (chars = 900) =>
  "Acme has launched a roasting guarantee for wholesale buyers. ".repeat(
    Math.ceil(chars / 60),
  );

const base = {
  url: "https://acme.com/news/roast-guarantee",
  title: "Acme launches a roast guarantee",
  body: prose(),
  sourceKind: "competitor_site",
};

describe("boilerplate paths", () => {
  it("names the class of page it filtered", () => {
    expect(boilerplateReason("https://acme.com/privacy")).toBe("a privacy policy");
    expect(boilerplateReason("https://acme.com/en/careers")).toBe("a careers page");
    expect(boilerplateReason("https://acme.com/contact-us")).toBe(
      "a contact or support page",
    );
    expect(boilerplateReason("https://acme.com/legal/terms")).toBe(
      "legal boilerplate",
    );
  });

  it("matches path SEGMENTS, so a competitor named after one is safe", () => {
    // The false positive this rule exists to avoid.
    expect(boilerplateReason("https://contact-ltd.com/products/new")).toBeNull();
    expect(boilerplateReason("https://acme.com/products/support-bracket")).toBeNull();
    expect(boilerplateReason("https://legal-eagles.com/news/expansion")).toBeNull();
  });

  it("returns null for a URL it cannot parse rather than guessing", () => {
    expect(boilerplateReason("not a url")).toBeNull();
  });

  it("skips a boilerplate page however long it is", () => {
    const verdict = scoreSignal({ ...base, url: "https://acme.com/privacy" });
    expect(verdict.worthAnalysing).toBe(false);
    expect(verdict.reason).toContain("privacy policy");
    expect(verdict.score).toBe(0);
  });
});

describe("thin pages", () => {
  it("skips a page with less prose than the floor and says how little", () => {
    const verdict = scoreSignal({ ...base, body: "Contact sales for pricing." });
    expect(verdict.worthAnalysing).toBe(false);
    expect(verdict.reason).toMatch(/only \d+ characters/);
  });

  it("counts collapsed prose, not raw whitespace", () => {
    const padded = `${"word ".repeat(20)}${"\n".repeat(2000)}`;
    expect(scoreSignal({ ...base, body: padded }).worthAnalysing).toBe(false);
  });

  it("accepts a page just over the floor", () => {
    const body = "a".repeat(MIN_PROSE_CHARS + 1);
    expect(scoreSignal({ ...base, body }).worthAnalysing).toBe(true);
  });

  it("never filters a social document for length — a caption with numbers is a signal", () => {
    const verdict = scoreSignal({
      url: "https://instagram.com/acme/p/1",
      title: "instagram @acme",
      body: "New roast. Out now.",
      sourceKind: "social_posts",
      metricsPresent: true,
    });
    expect(verdict.worthAnalysing).toBe(true);
  });
});

describe("navigation-dominant pages", () => {
  const menu = Array.from({ length: 30 }, (_, i) => `Link ${i}`).join("\n");

  it("measures the share of short lines", () => {
    expect(navigationRatio(menu)).toBe(1);
    expect(navigationRatio(prose())).toBe(0);
  });

  it("ignores the heuristic on a short page (too few lines to mean anything)", () => {
    expect(navigationRatio("One\nTwo\nThree")).toBe(0);
  });

  it("skips a page that is mostly menu", () => {
    const verdict = scoreSignal({ ...base, body: `${menu}\n${"x".repeat(500)}` });
    expect(verdict.worthAnalysing).toBe(false);
    expect(verdict.reason).toContain("navigation");
  });
});

describe("scoring the pages that survive", () => {
  it("is deterministic", () => {
    const a = scoreSignal(base);
    const b = scoreSignal(base);
    expect(a).toEqual(b);
    expect(a.worthAnalysing).toBe(true);
    expect(a.reason).toBe("");
  });

  it("ranks a press release with hard numbers above a plain page", () => {
    const plain = scoreSignal(base);
    const specific = scoreSignal({
      ...base,
      sourceKind: "press_release",
      body: `${prose()} In 2026 the range grew 24% and now starts at $12.`,
    });
    expect(specific.score).toBeGreaterThan(plain.score);
  });

  it("keeps the score inside 0..1", () => {
    const huge = scoreSignal({
      ...base,
      sourceKind: "press_release",
      body: `${prose(200_000)} 2026 99% $5`,
      metricsPresent: true,
    });
    expect(huge.score).toBeGreaterThan(0);
    expect(huge.score).toBeLessThanOrEqual(1);
  });

  it("gives an unknown source kind a floor rather than zero", () => {
    expect(scoreSignal({ ...base, sourceKind: null }).score).toBeGreaterThan(0);
  });
});
