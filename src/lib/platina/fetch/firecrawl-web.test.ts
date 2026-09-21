import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrapeError } from "@/lib/scrape/firecrawl";
import {
  cachedPicks,
  collectSiteWithFirecrawl,
  firecrawlPlan,
  firecrawlSitePlan,
  mapFirecrawlPage,
  shouldFallBack,
} from "./firecrawl-web";
import type { ApprovedScanSpec } from "./registry";
import { fetchViaWaters } from "./waters";

type Kind = ApprovedScanSpec["targets"][number]["kind"];

const spec = (kind: Kind, value = "https://example.com/page", maxPages?: number): ApprovedScanSpec => ({
  id: "s1",
  workspaceId: "w1",
  status: "approved",
  targets: [{ kind, value, ...(maxPages ? { maxPages } : {}) }],
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const firecrawlPage = (markdown = "# Product\n\nNew LC system launched.", statusCode = 200) =>
  json({
    success: true,
    data: {
      markdown,
      metadata: { title: "Product page", url: "https://example.com/page/", statusCode, creditsUsed: 1 },
    },
  });

const apifyItems = (markdown = "Apify body text") =>
  json([{ url: "https://example.com/page", metadata: { title: "From Apify" }, markdown }]);

const isFirecrawl = (url: string) => url.includes("firecrawl.dev");

beforeEach(() => {
  vi.stubEnv("FIRECRAWL_API_KEY", "fc-test");
  vi.stubEnv("APIFY_TOKEN", "apify-test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("which targets go to Firecrawl first", () => {
  it("single public pages of the four web kinds", () => {
    for (const kind of ["competitor_site", "press_release", "trade_editorial", "conference"] as const) {
      expect(firecrawlPlan({ kind, value: "https://example.com" }, 1, true)).toBe(true);
    }
  });

  it("not multi-page or sitemap crawls, social, ads, or when unconfigured", () => {
    expect(firecrawlPlan({ kind: "competitor_site", value: "https://example.com" }, 5, true)).toBe(false);
    expect(
      firecrawlPlan({ kind: "competitor_site", value: "https://example.com", seedFromSitemap: true }, 1, true),
    ).toBe(false);
    expect(firecrawlPlan({ kind: "social_profile", value: "instagram:@acme" }, 1, true)).toBe(false);
    expect(firecrawlPlan({ kind: "ad_library", value: "https://facebook.com/ads/library" }, 1, true)).toBe(false);
    expect(firecrawlPlan({ kind: "competitor_site", value: "https://www.instagram.com/acme" }, 1, true)).toBe(false);
    expect(firecrawlPlan({ kind: "competitor_site", value: "https://example.com" }, 1, false)).toBe(false);
  });

  it("falls back on anything another scraper could survive, not on a gone page", () => {
    expect(shouldFallBack(new ScrapeError("credits", true))).toBe(true);
    expect(shouldFallBack(new Error("anything unexpected"))).toBe(true);
    expect(shouldFallBack(new ScrapeError("The page answered 404.", false, 404))).toBe(false);
  });
});

describe("mapping", () => {
  it("is a Plane B doc: canonical, hashed, tagged firecrawl, metadata + extraction in raw", () => {
    const doc = mapFirecrawlPage(
      {
        url: "https://example.com/page/",
        title: "Product page",
        markdown: "body",
        json: { headline: "LC" },
        statusCode: 200,
        creditsUsed: 5,
        scrapedAt: "2026-09-21T00:00:00.000Z",
      },
      { kind: "competitor_site", value: "https://example.com/page" },
    );
    expect(doc.adapter).toBe("firecrawl");
    expect(doc.canonicalUrl).toBe("https://example.com/page");
    expect(doc.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.raw).toMatchObject({ provider: "firecrawl", creditsUsed: 5, extracted: { headline: "LC" } });
  });
});

describe("fetchViaWaters with Firecrawl as rung 1", () => {
  it("a single page read by Firecrawl never starts an Apify run", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      isFirecrawl(url) ? firecrawlPage() : apifyItems(),
    );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await fetchViaWaters(spec("competitor_site"));
    expect(outcome.docs).toHaveLength(1);
    expect(outcome.docs[0].adapter).toBe("firecrawl");
    expect(outcome.docs[0].body).toContain("New LC system");
    expect(outcome.pages).toBe(1);
    expect(outcome.fallbacks).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("when Firecrawl fails retryably, Apify collects it and the run gets a note, not a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) =>
        isFirecrawl(url) ? json({ success: false, error: "Payment required" }, 402) : apifyItems(),
      ),
    );
    const outcome = await fetchViaWaters(spec("press_release"));
    expect(outcome.failures).toEqual([]);
    expect(outcome.docs[0].adapter).toBe("apify");
    expect(outcome.fallbacks?.[0].reason).toMatch(/credits are used up/);
  });

  it("a page that answered 404 is one failure — no Apify spend to hear it again", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      isFirecrawl(url) ? firecrawlPage("gone", 404) : apifyItems(),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchViaWaters(spec("competitor_site"))).rejects.toThrow(/answered 404/);
    expect(fetchMock.mock.calls.every(([url]) => isFirecrawl(url))).toBe(true);
  });

  it("when both fail, the failure names both reasons", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) =>
        isFirecrawl(url)
          ? json({ success: false, error: "busy" }, 503)
          : json({}, 500),
      ),
    );
    await expect(fetchViaWaters(spec("competitor_site"))).rejects.toThrow(
      /Apify run failed \(500\).*before that, Firecrawl could not read the page \(503\)/,
    );
  });

  it("without a Firecrawl key, multi-page crawls stay on Apify exactly as before", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "");
    const fetchMock = vi.fn().mockImplementation(() => apifyItems());
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await fetchViaWaters(spec("competitor_site", "https://example.com/page", 5));
    expect(outcome.docs[0].adapter).toBe("apify");
    expect(fetchMock.mock.calls.some(([url]) => isFirecrawl(url))).toBe(false);
  });
});

describe("site rung (C1) — several pages of one site", () => {
  const W = "https://www.waters.com";
  const page = (url: string, markdown = `# ${url}\n\nText about ${url} long enough to matter.`) => ({
    url,
    title: url,
    markdown,
    scrapedAt: "2026-09-21T00:00:00.000Z",
  });
  const target = { kind: "competitor_site" as const, value: `${W}/`, maxPages: 4 };
  const links = [
    { url: `${W}/nextgen/us/en/about-waters.html`, title: "About Waters" },
    { url: `${W}/nextgen/us/en/contact-us.html`, title: "Contact" },
    { url: `${W}/nextgen/us/en/login.html`, title: "Sign in" },
    { url: "https://ir.waters.com/News--Events/newsroom/default.aspx", title: "Newsroom" },
    { url: `${W}/nextgen/us/en/products/chromatography.html`, title: "Chromatography products" },
  ];

  it("takes multi-page web targets only", () => {
    expect(firecrawlSitePlan({ kind: "competitor_site", value: W }, 4, true)).toBe(true);
    expect(firecrawlSitePlan({ kind: "competitor_site", value: W }, 1, true)).toBe(false);
    expect(firecrawlSitePlan({ kind: "ad_library", value: W }, 4, true)).toBe(false);
    expect(firecrawlSitePlan({ kind: "competitor_site", value: W }, 4, false)).toBe(false);
  });

  it("reads the start page plus picked pages — newsroom yes, contact/sign-in never", async () => {
    const scraped: string[] = [];
    const result = await collectSiteWithFirecrawl(target, 4, {
      scrape: async (url) => {
        scraped.push(url);
        return page(url);
      },
      map: async () => links,
    });
    expect(result.pages).toBe(4);
    expect(scraped).toContain("https://ir.waters.com/News--Events/newsroom/default.aspx");
    expect(scraped.some((u) => /contact|login/.test(u))).toBe(false);
    expect(result.picked).toHaveLength(3);
    // Every page files under the source it was collected for.
    expect(result.docs.every((d) => d.sourceUrl === `${W}/` && d.adapter === "firecrawl")).toBe(true);
    expect(new Set(result.docs.map((d) => d.canonicalUrl)).size).toBe(4);
  });

  it("reuses a week-old pick without listing the site again", async () => {
    const map = vi.fn(async () => links);
    const now = new Date("2026-09-21T12:00:00Z");
    const remembered = {
      ...target,
      pickedPages: [`${W}/nextgen/us/en/about-waters.html`],
      pickedAt: new Date(now.getTime() - 2 * 86_400_000).toISOString(),
    };
    const result = await collectSiteWithFirecrawl(remembered, 4, { scrape: async (u) => page(u), map, now });
    expect(map).not.toHaveBeenCalled();
    expect(result.picked).toBeUndefined();
    expect(result.pages).toBe(2);
    expect(cachedPicks({ ...remembered, pickedAt: "2026-09-01T00:00:00Z" }, now)).toBeNull();
  });

  it("a picked page that fails is skipped with its reason; the start page failing is the caller's to fall back on", async () => {
    const result = await collectSiteWithFirecrawl(target, 3, {
      scrape: async (url) => {
        if (url.includes("about")) throw new Error("Firecrawl is rate-limiting right now (429).");
        return page(url);
      },
      map: async () => links,
    });
    expect(result.skipped[0].reason).toMatch(/429/);
    await expect(
      collectSiteWithFirecrawl(target, 3, {
        scrape: async () => {
          throw new ScrapeError("down", true);
        },
        map: async () => links,
      }),
    ).rejects.toThrow("down");
  });

  it("the adapter uses it for multi-page sources and remembers the picks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.endsWith("/map")) return json({ success: true, links });
        const { url: pageUrl } = JSON.parse(String(init?.body));
        return json({ success: true, data: { markdown: `# ${pageUrl}\n\nBody text for ${pageUrl}.`, metadata: { url: pageUrl, statusCode: 200 } } });
      }),
    );
    const outcome = await fetchViaWaters(spec("competitor_site", `${W}/`, 4));
    expect(outcome.docs).toHaveLength(4);
    expect(outcome.docs.every((d) => d.adapter === "firecrawl")).toBe(true);
    expect(outcome.picked?.[0].urls).toHaveLength(3);
    expect(outcome.pages).toBe(4);
  });
});
