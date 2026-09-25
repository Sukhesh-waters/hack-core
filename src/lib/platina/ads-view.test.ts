import { describe, expect, it } from "vitest";
import { adInsights, buildAdsView, type AdDoc } from "./ads-view";

const now = new Date("2026-09-24T12:00:00Z");
let n = 0;
const li = (
  brandId: string,
  advertiser: string,
  opts: { start: string; end: string; countries?: [string, string][]; headline?: string; impressions?: string; fetchedAt?: string; id?: string },
): AdDoc => {
  const adId = opts.id ?? String(++n);
  const url = `https://www.linkedin.com/ad-library/detail/${adId}`;
  return {
    id: `doc-${adId}-${opts.fetchedAt ?? "a"}`,
    brandId,
    sourceUrl: `https://www.linkedin.com/ad-library/search?accountOwner=${encodeURIComponent(advertiser)}`,
    canonicalUrl: url,
    fetchedAt: new Date(opts.fetchedAt ?? "2026-09-24T08:00:00Z"),
    body: `${opts.headline ?? "Headline"}\n\nBody`,
    raw: {
      platform: "linkedin",
      adId,
      adLibraryUrl: url,
      advertiserName: advertiser,
      headline: opts.headline ?? "Headline",
      body: "Body",
      ctas: ["Learn more"],
      clickUrl: "https://www.example.com/landing?trk=ad_library_ad_preview&x=1",
      availability: { start: opts.start, end: opts.end },
      impressions: opts.impressions ?? "1k-5k",
      impressionsPerCountry: (opts.countries ?? [["United States", "100%"]]).map(([country, impressions]) => ({ country, impressions })),
      targeting: { location: "Worldwide" },
    },
  };
};

const client = { id: "w", name: "Waters" };
const competitors = [
  { id: "a", name: "Agilent" },
  { id: "s", name: "Shimadzu" },
];

describe("buildAdsView (C8.3)", () => {
  const docs = [
    li("w", "Waters Corporation", { id: "w1", start: "2026-09-10", end: "2026-09-24", headline: "GLP-1 aggregation", impressions: "100k-150k" }),
    li("w", "Waters Corporation", { id: "w1", start: "2026-09-10", end: "2026-09-11", fetchedAt: "2026-09-12T08:00:00Z" }),
    li("w", "Waters Corporation", { id: "w2", start: "2026-06-01", end: "2026-09-23", headline: "Long runner" }),
    li("a", "Agilent Technologies", { start: "2026-09-01", end: "2026-09-24", countries: [["United Arab Emirates", "60%"], ["Saudi Arabia", "40%"]] }),
    li("a", "Agilent Technologies", { start: "2026-09-05", end: "2026-09-24", countries: [["Saudi Arabia", "100%"]] }),
    li("a", "Agilent Technologies", { start: "2026-09-20", end: "2026-09-24" }),
    li("s", "Shimadzu Middle East & Africa", { start: "2026-09-02", end: "2026-09-03", countries: [["Qatar", "100%"]] }),
    li("x", "Someone else", { start: "2026-09-20", end: "2026-09-24" }),
  ];
  const topicsByAd = new Map<string, string[]>([
    ["https://www.linkedin.com/ad-library/detail/w1", ["glp-1"]],
    ["https://www.linkedin.com/ad-library/detail/1", ["pfas analysis"]],
    ["https://www.linkedin.com/ad-library/detail/2", ["pfas analysis"]],
    ["https://www.linkedin.com/ad-library/detail/3", ["pfas analysis"]],
  ]);
  const view = buildAdsView({ client, competitors, docs, topicsByAd, now });
  const col = (id: string) => view.columns.find((c) => c.brandId === id)!;

  it("puts each company in its own column, one card per ad from its newest snapshot", () => {
    expect(view.columns.map((c) => c.name)).toEqual(["Waters", "Agilent", "Shimadzu"]);
    const w1 = col("w").ads.find((a) => a.key.endsWith("/w1"))!;
    expect(col("w").ads).toHaveLength(2);
    expect(w1).toMatchObject({ endedOn: "2026-09-24", active: true, daysRunning: 15, impressions: "100k-150k", isNew: false });
    expect(w1.landingUrl).toBe("https://www.example.com/landing?x=1");
    expect(view.totals.ads).toBe(6);
  });

  it("reads countries with their share of impressions and flags ads shown in the Gulf", () => {
    const ad = col("a").ads.find((a) => a.countries.some((c) => c.code === "AE"))!;
    expect(ad.countries).toEqual([
      { code: "AE", name: "United Arab Emirates", share: "60%" },
      { code: "SA", name: "Saudi Arabia", share: "40%" },
    ]);
    expect(ad.inRegion).toBe(true);
    expect(col("a").regionAds).toBe(2);
    expect(col("s").ads[0].active).toBe(false);
  });

  it("detects a region gap, a push and ad white space — each with proofs", () => {
    const kinds = view.detections.map((d) => d.key);
    expect(kinds).toContain("region_gap:a:AE-SA-QA-KW-OM-BH");
    // Shimadzu has one ad in the Gulf: below the gate, no detection.
    expect(kinds.some((k) => k.startsWith("region_gap:s"))).toBe(false);
    const push = view.detections.find((d) => d.kind === "push")!;
    expect(push).toMatchObject({ key: "push:a:pfas analysis", n: 3 });
    expect(push.proofs[0].url).toMatch(/ad-library\/detail/);
    expect(view.detections.find((d) => d.kind === "theme_gap")?.detail).toBe(
      "Agilent ran 3 ads on pfas analysis in the last 90 days; Waters ran none.",
    );
    const long = view.detections.find((d) => d.kind === "long_runner")!;
    expect(long.title).toBe("Waters has kept one ad running for 115 days");
  });

  it("calls no region gap when the client's own ads reach the region", () => {
    const withGulf = [...docs, li("w", "Waters Corporation", { start: "2026-09-15", end: "2026-09-24", countries: [["Qatar", "100%"]] })];
    const v = buildAdsView({ client, competitors, docs: withGulf, topicsByAd, now });
    expect(v.detections.some((d) => d.kind === "region_gap")).toBe(false);
  });

  it("turns detections into Brain insights citing the ad documents, never the client's own long runner", () => {
    const insights = adInsights(client, view, now);
    expect(insights.map((i) => i.key)).toContain("ads:w:push:a:pfas analysis");
    expect(insights.some((i) => i.key.startsWith("ads:w:long_runner"))).toBe(false);
    const push = insights.find((i) => i.key === "ads:w:push:a:pfas analysis")!;
    expect(push.content).toContain("activity, not performance");
    expect(push.sourceSignalIds).toHaveLength(3);
    // Same data -> same sentences: an unchanged detection is not rewritten.
    expect(adInsights(client, buildAdsView({ client, competitors, docs, topicsByAd, now }), now)).toEqual(insights);
  });
});
