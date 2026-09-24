import { describe, expect, it } from "vitest";
import { planAdScan } from "./ads-scan";

const brands = [
  { id: "w", name: "Waters", isClient: true },
  { id: "t", name: "Thermo Fisher", isClient: false },
];
const specs = [
  {
    id: "spec-t",
    brandId: "t",
    status: "approved",
    targets: [{ kind: "ad_library" as const, value: "https://www.linkedin.com/ad-library/search?accountOwner=Thermo%20Fisher%20Scientific" }],
  },
  // A Meta ad source is not the LinkedIn one.
  { id: "spec-w-meta", brandId: "w", status: "approved", targets: [{ kind: "ad_library" as const, value: "https://www.facebook.com/ads/library/?q=Waters" }] },
];

describe("planAdScan (C8.3)", () => {
  it("reuses a brand's LinkedIn ad source and its advertiser name; otherwise the typed name or the brand name", () => {
    const plan = planAdScan({ brands, specs, advertisers: new Map([["w", "Waters Corporation"]]), apify: { usedUsd: 1.19, capUsd: 5 } });
    expect(plan.rows).toEqual([
      expect.objectContaining({ brandId: "w", advertiser: "Waters Corporation", specId: null, maxAds: 25 }),
      expect.objectContaining({ brandId: "t", advertiser: "Thermo Fisher Scientific", specId: "spec-t" }),
    ]);
    expect(plan.rows[0].url).toBe("https://www.linkedin.com/ad-library/search?accountOwner=Waters%20Corporation");
    expect(plan).toMatchObject({ maxAds: 50, projectedUsd: 0.2, spendableUsd: 2.81, allowed: true });
  });

  it("refuses a scan that could pass the month's money after the reserve, unless approved over", () => {
    const tight = { usedUsd: 3.9, capUsd: 5 };
    const plan = planAdScan({ brands, specs, apify: tight });
    expect(plan.allowed).toBe(false);
    expect(plan.reason).toContain("$0.10 is left");
    expect(planAdScan({ brands, specs, apify: tight, approveOver: true }).allowed).toBe(true);
    expect(planAdScan({ brands, specs, apify: tight, perAdvertiser: 10 }).allowed).toBe(true);
  });

  it("refuses when Apify's usage cannot be read", () => {
    expect(planAdScan({ brands, specs, apify: null })).toMatchObject({ allowed: false, spendableUsd: null });
  });
});
