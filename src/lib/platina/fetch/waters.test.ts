import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovedScanSpec } from "./registry";
import { actorForSourceKind, fetchViaWaters } from "./waters";

const spec = (kind: ApprovedScanSpec["targets"][number]["kind"]): ApprovedScanSpec => ({
  id: "s1",
  workspaceId: "w1",
  status: "approved",
  targets: [{ kind, value: "https://example.com/page" }],
});

function mockApify(items: Record<string, unknown>[]) {
  return vi.fn<(url: string, init?: RequestInit) => Promise<{
    ok: boolean;
    json: () => Promise<Record<string, unknown>[]>;
  }>>(async () => ({
    ok: true,
    json: async () => items,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("actorForSourceKind", () => {
  it("maps the four web kinds to the website content crawler", () => {
    for (const kind of [
      "competitor_site",
      "press_release",
      "trade_editorial",
      "conference",
    ] as const) {
      expect(actorForSourceKind(kind)).toBe("apify~website-content-crawler");
    }
  });

  it("maps ad_library to the verified Meta Ad Library actor", () => {
    expect(actorForSourceKind("ad_library")).toBe(
      "curious_coder~facebook-ads-library-scraper",
    );
  });

  it("throws on an unknown kind instead of guessing", () => {
    expect(() =>
      actorForSourceKind("mystery_kind" as never),
    ).toThrow(/no actor mapped/);
  });
});

describe("fetchViaWaters", () => {
  it("maps crawler output to hashed, canonical Plane B documents", async () => {
    process.env.APIFY_TOKEN = "test-token";
    vi.stubGlobal(
      "fetch",
      mockApify([
        {
          url: "https://example.com/page/",
          metadata: { title: "Product page" },
          markdown: "New LC system launched",
        },
      ]),
    );
    const outcome = await fetchViaWaters(spec("competitor_site"));
    expect(outcome.failures).toEqual([]);
    expect(outcome.docs).toHaveLength(1);
    const doc = outcome.docs[0];
    expect(doc.sourceKind).toBe("competitor_site");
    expect(doc.canonicalUrl).toBe("https://example.com/page");
    expect(doc.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.title).toBe("Product page");
    expect(doc.adapter).toBe("apify");
    delete process.env.APIFY_TOKEN;
  });

  it("sends the single-page cheerio contract for web kinds", async () => {
    process.env.APIFY_TOKEN = "test-token";
    const fetchMock = mockApify([
      {
        url: "https://example.com/page",
        metadata: { title: "Agenda" },
        markdown: "Conference agenda",
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await fetchViaWaters(spec("conference"));
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body).toMatchObject({
      startUrls: [{ url: "https://example.com/page" }],
      maxCrawlDepth: 0,
      maxCrawlPages: 1,
      crawlerType: "cheerio",
    });
    expect(outcome.docs).toHaveLength(1);
    expect(outcome.failures).toEqual([]);
    delete process.env.APIFY_TOKEN;
  });

  it("an empty actor result is a failure entry, never a fake document", async () => {
    process.env.APIFY_TOKEN = "test-token";
    vi.stubGlobal("fetch", mockApify([]));
    // Single target, zero usable items → all failed → throws (run = failed).
    const outcome = await fetchViaWaters(spec("conference")).catch((e) => e);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toMatch(/no usable items/);
    delete process.env.APIFY_TOKEN;
  });

  it("sends the ad-library contract: urls objects, proxy, count 10", async () => {
    process.env.APIFY_TOKEN = "test-token";
    const fetchMock = mockApify([
      {
        ad_archive_id: "123",
        page_name: "Waters",
        snapshot: { body: "Ad copy" },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await fetchViaWaters(spec("ad_library"));
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.urls).toEqual([{ url: "https://example.com/page" }]);
    expect(body.count).toBe(10);
    expect(body.proxy.useApifyProxy).toBe(true);
    expect(outcome.docs[0].title).toBe("Waters · 123");
    expect(outcome.docs[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
    delete process.env.APIFY_TOKEN;
  });

  it("drops actor error items instead of storing them", async () => {
    process.env.APIFY_TOKEN = "test-token";
    vi.stubGlobal("fetch", mockApify([{ error: "rate limited" }]));
    const outcome = await fetchViaWaters(spec("ad_library")).catch((e) => e);
    // Every target failed → the fetch throws so the run is marked failed.
    expect(outcome).toBeInstanceOf(Error);
    delete process.env.APIFY_TOKEN;
  });

  it("rejects invalid URLs without calling the actor", async () => {
    process.env.APIFY_TOKEN = "test-token";
    const fetchMock = mockApify([]);
    vi.stubGlobal("fetch", fetchMock);
    const bad: ApprovedScanSpec = {
      ...spec("competitor_site"),
      targets: [{ kind: "competitor_site", value: "not-a-url" }],
    };
    const outcome = await fetchViaWaters(bad).catch((e) => e);
    expect(outcome).toBeInstanceOf(Error);
    expect(fetchMock).not.toHaveBeenCalled();
    delete process.env.APIFY_TOKEN;
  });
});

describe("fetchViaWaters — Apify account limits", () => {
  beforeEach(() => {
    process.env.APIFY_TOKEN = "test-token";
  });
  afterEach(() => {
    delete process.env.APIFY_TOKEN;
  });

  it("passes the requested memory so parallel runs share the account's memory pool", async () => {
    const fetchMock = mockApify([{ url: "https://example.com/page", markdown: "hello world", metadata: { title: "t" } }]);
    vi.stubGlobal("fetch", fetchMock);
    await fetchViaWaters(spec("competitor_site"));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("?memory=1024");
    // The token travels in the Authorization header, never the URL.
    expect(String(url)).not.toContain("token=");
    expect(new Headers(init.headers).get("authorization")).toMatch(/^Bearer /);
  });

  it("explains a 402 as an account limit (memory or usage), not a problem with the site", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 402, json: async () => ({}) })));
    await expect(fetchViaWaters(spec("competitor_site"))).rejects.toThrow(
      /Apify refused the run \(402\).*memory or usage limit/,
    );
  });
});
