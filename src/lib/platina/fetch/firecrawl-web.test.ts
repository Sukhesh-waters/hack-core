import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrapeError } from "@/lib/scrape/firecrawl";
import { firecrawlPlan, mapFirecrawlPage, shouldFallBack } from "./firecrawl-web";
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

  it("multi-page crawls stay on Apify", async () => {
    const fetchMock = vi.fn().mockImplementation(() => apifyItems());
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await fetchViaWaters(spec("competitor_site", "https://example.com/page", 5));
    expect(outcome.docs[0].adapter).toBe("apify");
    expect(fetchMock.mock.calls.some(([url]) => isFirecrawl(url))).toBe(false);
  });
});
