import { describe, expect, it, vi } from "vitest";
import { OWN_BRAND_SKIP, planAnalysis } from "./analysis-plan";

const prose =
  "Bluebird Roasters has introduced a 48-hour roast guarantee for wholesale buyers across the country. ".repeat(
    8,
  );

const signal = {
  title: "Roast guarantee",
  body: prose,
  sourceUrl: "https://bluebird.example/news/roast-guarantee",
  canonicalUrl: "https://bluebird.example/news/roast-guarantee",
  sourceKind: "competitor_site",
  fetchedAt: new Date("2026-09-21T09:00:00Z"),
};

const competitor = {
  kind: "competitor",
  brandName: "Bluebird Roasters",
  clientName: "Northwind Coffee",
  sourceKind: "competitor_site",
};

const noPrevious = () => Promise.resolve(null);

describe("the cost guarantee", () => {
  it("skips a client's own page without reading anything else", async () => {
    const loadPrevious = vi.fn(noPrevious);
    const plan = await planAnalysis({
      signal,
      subject: { ...competitor, kind: "own_brand" },
      loadPrevious,
    });

    expect(plan).toEqual({ action: "skip", reason: OWN_BRAND_SKIP, cause: "own_brand" });
    expect(loadPrevious).not.toHaveBeenCalled();
  });

  it("skips a boilerplate page BEFORE the previous-version query", async () => {
    const loadPrevious = vi.fn(noPrevious);
    const plan = await planAnalysis({
      signal: {
        ...signal,
        canonicalUrl: "https://bluebird.example/privacy",
        sourceUrl: "https://bluebird.example/privacy",
      },
      subject: competitor,
      loadPrevious,
    });

    expect(plan.action).toBe("skip");
    expect(plan.action === "skip" && plan.cause).toBe("low_value");
    expect(plan.action === "skip" && plan.reason).toContain("privacy policy");
    // The guarantee: nothing was queried and no input was built, so the caller
    // cannot reach a provider for this document.
    expect(loadPrevious).not.toHaveBeenCalled();
  });

  it("skips a thin page the same way", async () => {
    const loadPrevious = vi.fn(noPrevious);
    const plan = await planAnalysis({
      signal: { ...signal, body: "Call us." },
      subject: competitor,
      loadPrevious,
    });
    expect(plan.action).toBe("skip");
    expect(loadPrevious).not.toHaveBeenCalled();
  });
});

describe("the input a surviving document produces", () => {
  it("names the competitor and the client it is watched for", async () => {
    const plan = await planAnalysis({ signal, subject: competitor, loadPrevious: noPrevious });
    expect(plan.action).toBe("analyse");
    if (plan.action !== "analyse") return;
    expect(plan.input).toContain("Competitor: Bluebird Roasters");
    expect(plan.input).toContain("Watched for client: Northwind Coffee");
    expect(plan.changed).toBe(false);
  });

  it("includes what changed when there is a previous version", async () => {
    const plan = await planAnalysis({
      signal,
      subject: competitor,
      loadPrevious: async () => ({
        title: "Roast guarantee",
        body: "Bluebird Roasters roasts to order for wholesale buyers across the country.",
        fetchedAt: new Date("2026-09-14T09:00:00Z"),
      }),
    });

    expect(plan.action).toBe("analyse");
    if (plan.action !== "analyse") return;
    expect(plan.changed).toBe(true);
    expect(plan.input).toContain("WHAT CHANGED — this is the signal");
    expect(plan.input).toContain("since 7 days ago");
  });

  it("treats a cosmetic-only change as no change", async () => {
    const stable = "Trusted by 1,024 roasters worldwide, with a full wholesale range. ".repeat(8);
    const plan = await planAnalysis({
      signal: { ...signal, body: stable.replace("1,024", "1,031") },
      subject: competitor,
      loadPrevious: async () => ({
        title: "Roast guarantee",
        body: stable,
        fetchedAt: new Date("2026-09-14T09:00:00Z"),
      }),
    });

    expect(plan.action === "analyse" && plan.changed).toBe(false);
  });

  it("says a source is unlinked rather than inventing a competitor", async () => {
    const plan = await planAnalysis({ signal, subject: null, loadPrevious: noPrevious });
    expect(plan.action === "analyse" && plan.input).toContain("not linked to a client");
  });

  it("keeps a social document with measurements even when its caption is short", async () => {
    const plan = await planAnalysis({
      signal: {
        ...signal,
        title: "instagram @bluebird",
        body: "New roast out now.",
        canonicalUrl: "https://instagram.com/p/xyz",
        sourceUrl: "instagram:@bluebird",
        sourceKind: "social_posts",
        metrics: { likes: 412, comments: 18 },
      },
      subject: competitor,
      loadPrevious: noPrevious,
    });

    expect(plan.action).toBe("analyse");
    expect(plan.action === "analyse" && plan.input).toContain("MEASURED ENGAGEMENT");
  });
});
