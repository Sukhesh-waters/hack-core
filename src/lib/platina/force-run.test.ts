import { describe, expect, it } from "vitest";
import { ESTIMATE, RESERVE, flowOf, planForceRun, targetCost, type ForceSpec } from "./force-run";

const spec = (over: Partial<ForceSpec>): ForceSpec => ({
  id: "s1",
  name: "Agilent · website",
  status: "approved",
  enabled: true,
  brandKind: "competitor",
  targets: [{ kind: "competitor_site", maxPages: 10 }],
  specRemaining: 48,
  ...over,
});

const specs: ForceSpec[] = [
  spec({ id: "own", name: "Waters · website", brandKind: "own_brand", targets: [{ kind: "competitor_site", maxPages: 5, pickedPages: ["a"] }] }),
  spec({ id: "agilent", name: "Agilent · website" }),
  spec({ id: "li", name: "Waters · linkedin posts", brandKind: "own_brand", targets: [{ kind: "social_posts", maxPages: 25 }] }),
  spec({ id: "arablab", name: "ARABLAB LIVE", brandKind: null, targets: [{ kind: "conference", maxPages: 1 }] }),
  spec({ id: "ads", name: "Waters · ads", brandKind: "own_brand", targets: [{ kind: "ad_library", maxPages: 5 }] }),
];

const plenty = { apifyUsd: 4, firecrawlCredits: 1000 };

describe("flowOf", () => {
  it("names each source's flow by what it reads and whose it is", () => {
    expect(specs.map(flowOf)).toEqual(["client", "competitors", "linkedin", "conferences", "ads"]);
  });
});

describe("targetCost (estimates)", () => {
  it("a web page is one Firecrawl credit; a site read the first time also pays to list it", () => {
    expect(targetCost({ kind: "conference" }, 1)).toEqual({ firecrawlCredits: 1, apifyUsd: 0 });
    expect(targetCost({ kind: "competitor_site" }, 10).firecrawlCredits).toBe(10 + ESTIMATE.firecrawlCreditsPerSiteMap);
    expect(targetCost({ kind: "competitor_site", pickedPages: ["x"] }, 10).firecrawlCredits).toBe(10);
  });

  it("the ad library charges its 10-result minimum", () => {
    expect(targetCost({ kind: "ad_library" }, 3).apifyUsd).toBeCloseTo(10 * ESTIMATE.apifyUsdPerAd);
  });
});

describe("planForceRun (C8.0 F0.5)", () => {
  it("plans only the chosen flows, with a seed grant per source and projected cost", () => {
    const plan = planForceRun({ specs, flows: ["conferences", "competitors"], remaining: plenty });
    expect(plan.items.map((i) => [i.specId, i.seedPages])).toEqual([
      ["agilent", 10],
      ["arablab", 1],
    ]);
    expect(plan.totals).toEqual({ firecrawlCredits: 12, apifyUsd: 0, pages: 11 });
    expect(plan.refusal).toBeNull();
  });

  it("never grants more than the source's own daily limit leaves", () => {
    const plan = planForceRun({ specs: [spec({ specRemaining: 3 })], flows: ["competitors"], remaining: plenty });
    expect(plan.items[0].seedPages).toBe(3);
  });

  it("skips unapproved sources and sources out for today, saying why", () => {
    const plan = planForceRun({
      specs: [spec({ id: "a", name: "Draft", status: "draft" }), spec({ id: "b", name: "Spent", specRemaining: 0 })],
      flows: ["competitors"],
      remaining: plenty,
    });
    expect(plan.items).toEqual([]);
    expect(plan.skipped.map((s) => s.name)).toEqual(["Draft", "Spent"]);
    expect(plan.skipped[1].reason).toContain("daily limit");
  });

  it("refuses the whole plan when it would eat into the Apify reserve", () => {
    const plan = planForceRun({ specs, flows: ["linkedin", "ads"], remaining: { apifyUsd: RESERVE.apifyUsd + 0.05, firecrawlCredits: 1000 } });
    expect(plan.totals.apifyUsd).toBeCloseTo(0.05 + 0.075);
    expect(plan.refusal).toContain("Apify");
  });

  it("refuses when the Firecrawl reserve would be crossed", () => {
    const plan = planForceRun({ specs, flows: ["competitors"], remaining: { apifyUsd: 4, firecrawlCredits: RESERVE.firecrawlCredits + 5 } });
    expect(plan.refusal).toContain("Firecrawl");
  });

  it("refuses a paid plan when a balance could not be read", () => {
    expect(planForceRun({ specs, flows: ["linkedin"], remaining: { apifyUsd: null, firecrawlCredits: 1000 } }).refusal).toContain(
      "APIFY_TOKEN",
    );
    // A plan that spends nothing on that account does not need its balance.
    expect(planForceRun({ specs, flows: ["conferences"], remaining: { apifyUsd: null, firecrawlCredits: 1000 } }).refusal).toBeNull();
  });
});
