import { describe, expect, it } from "vitest";
import { pickSitePages } from "@/lib/scrape/site";
import {
  applyProbe,
  mergeSiteMap,
  needsRemap,
  pageKey,
  pagesToProbe,
  pagesToRead,
  summariseOwnSite,
  type OwnSitePageRow,
} from "./own-site";

const NOW = new Date("2026-09-22T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function page(over: Partial<OwnSitePageRow> & { id: string }): OwnSitePageRow {
  return {
    url: `https://www.waters.com/${over.id}`,
    title: null,
    priority: 1,
    status: "queued",
    contentHash: null,
    etag: null,
    lastModified: null,
    changeDetectedAt: null,
    lastReadAt: null,
    lastCheckedAt: null,
    updatedAt: daysAgo(0),
    ...over,
  };
}

describe("pickSitePages keepAll (own site)", () => {
  const links = [
    { url: "https://www.waters.com/nextgen/us/en/products/chromatography.html" },
    { url: "https://www.waters.com/nextgen/us/en/some/deep/unscored/page.html" },
    { url: "https://www.waters.com/nextgen/us/en/careers.html" },
    { url: "https://www.waters.com/nextgen/de/de/produkte.html" },
    { url: "https://thermofisher.com/products" },
  ];

  it("keeps unscored same-site pages but still drops noise, other languages and other sites", () => {
    const all = pickSitePages({
      startUrl: "https://www.waters.com/nextgen/us/en.html",
      links,
      max: 100,
      keepAll: true,
    }).map((p) => p.url);
    expect(all[0]).toContain("/products/");
    expect(all.some((u) => u.includes("unscored"))).toBe(true);
    expect(all.some((u) => u.includes("careers"))).toBe(false);
    expect(all.some((u) => u.includes("/de/"))).toBe(false);
    expect(all.some((u) => u.includes("thermofisher"))).toBe(false);
  });

  it("without keepAll the unscored page is dropped (InstaMedia behaviour unchanged)", () => {
    const some = pickSitePages({ startUrl: "https://www.waters.com/nextgen/us/en.html", links, max: 100 });
    expect(some.some((p) => p.url.includes("unscored"))).toBe(false);
  });
});

describe("mergeSiteMap", () => {
  it("inserts new pages, re-prioritises known ones, marks missing ones gone, requeues returning ones", () => {
    const existing = [
      { id: "a", url: "https://x.com/a/", status: "read" as const },
      { id: "b", url: "https://x.com/b", status: "read" as const },
      { id: "c", url: "https://x.com/c", status: "gone" as const },
    ];
    const merge = mergeSiteMap(
      existing,
      [
        { url: "https://x.com/a", score: 5, title: "A" },
        { url: "https://x.com/c", score: 2 },
        { url: "https://x.com/new#top", score: 1 },
      ],
      10,
    );
    expect(merge.insert).toEqual([{ url: "https://x.com/new#top", title: null, priority: 1 }]);
    expect(merge.update).toEqual([
      { id: "a", title: "A", priority: 5, requeue: false },
      { id: "c", title: null, priority: 2, requeue: true },
    ]);
    expect(merge.gone).toEqual(["b"]);
  });

  it("respects the page cap: pages past it are not inserted", () => {
    const merge = mergeSiteMap([], [1, 2, 3].map((i) => ({ url: `https://x.com/${i}`, score: 10 - i })), 2);
    expect(merge.insert.map((p) => p.url)).toEqual(["https://x.com/1", "https://x.com/2"]);
  });

  it("pageKey ignores hash and trailing slash", () => {
    expect(pageKey("https://x.com/a/#b")).toBe(pageKey("https://x.com/a"));
  });
});

describe("needsRemap", () => {
  it("maps when never mapped or older than 7 days", () => {
    expect(needsRemap(null, NOW)).toBe(true);
    expect(needsRemap(daysAgo(8), NOW)).toBe(true);
    expect(needsRemap(daysAgo(2), NOW)).toBe(false);
  });
});

describe("probe cadence", () => {
  it("probes only read, unflagged pages not checked in 3 days", () => {
    const due = pagesToProbe(
      [
        page({ id: "fresh", status: "read", lastCheckedAt: daysAgo(1) }),
        page({ id: "due", status: "read", lastCheckedAt: daysAgo(4) }),
        page({ id: "never", status: "read" }),
        page({ id: "flagged", status: "read", changeDetectedAt: daysAgo(1) }),
        page({ id: "queued" }),
      ],
      NOW,
    ).map((p) => p.id);
    expect(due).toEqual(["due", "never"]);
  });

  it("changed flags a re-read and stores the new validators", () => {
    const upd = applyProbe(page({ id: "p", status: "read" }), { outcome: "changed", etag: "e2", lastModified: null }, NOW);
    expect(upd).toEqual({ lastCheckedAt: NOW, changeDetectedAt: NOW, etag: "e2", lastModified: null });
  });

  it("unchanged spends nothing", () => {
    expect(applyProbe(page({ id: "p", status: "read" }), { outcome: "unchanged" }, NOW).changeDetectedAt).toBeNull();
  });

  it("no validators: re-read only when the last read is 30+ days old", () => {
    const recent = page({ id: "r", status: "read", lastReadAt: daysAgo(5) });
    const old = page({ id: "o", status: "read", lastReadAt: daysAgo(31) });
    expect(applyProbe(recent, { outcome: "unsupported" }, NOW).changeDetectedAt).toBeNull();
    expect(applyProbe(old, { outcome: "unsupported" }, NOW).changeDetectedAt).toEqual(NOW);
  });
});

describe("pagesToRead", () => {
  const pages = [
    page({ id: "q-low", priority: 1 }),
    page({ id: "q-high", priority: 6 }),
    page({ id: "changed-late", status: "read", changeDetectedAt: daysAgo(1) }),
    page({ id: "changed-early", status: "read", changeDetectedAt: daysAgo(3) }),
    page({ id: "failed-recent", status: "failed", updatedAt: daysAgo(1) }),
    page({ id: "failed-old", status: "failed", updatedAt: daysAgo(8) }),
    page({ id: "read-ok", status: "read" }),
  ];

  it("changed first, then queued by priority, then failed past the retry wait", () => {
    expect(pagesToRead(pages, 10, NOW).map((p) => p.id)).toEqual([
      "changed-early",
      "changed-late",
      "q-high",
      "q-low",
      "failed-old",
    ]);
  });

  it("stops at the daily budget", () => {
    expect(pagesToRead(pages, 3, NOW)).toHaveLength(3);
    expect(pagesToRead(pages, 0, NOW)).toEqual([]);
  });
});

describe("summariseOwnSite", () => {
  it("counts live pages and excludes gone ones from the total", () => {
    const s = summariseOwnSite([
      page({ id: "a", status: "read", lastReadAt: daysAgo(2) }),
      page({ id: "b", status: "read", changeDetectedAt: daysAgo(1), lastReadAt: daysAgo(1) }),
      page({ id: "c" }),
      page({ id: "d", status: "failed" }),
      page({ id: "e", status: "gone" }),
    ]);
    expect(s).toEqual({ total: 4, read: 2, queued: 1, failed: 1, changed: 1, gone: 1, lastReadAt: daysAgo(1) });
  });
});
