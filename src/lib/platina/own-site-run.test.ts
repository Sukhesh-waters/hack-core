import { describe, expect, it } from "vitest";
import type { OwnSitePageRow } from "./own-site";
import { dominantLocaleUrl, runOwnSitePass, type OwnSiteDeps } from "./own-site-run";

const NOW = new Date("2026-09-22T12:00:00Z");
const HOME = "https://www.waters.com/nextgen/us/en.html";

type Store = {
  pages: OwnSitePageRow[];
  chunks: { pageId: string; content: string }[];
  retired: string[];
  mappedAt: Date | null;
  mapError: string | null;
  scrapes: string[];
};

function fakeDeps(
  store: Store,
  over: Partial<OwnSiteDeps> = {},
  opts: { links?: { url: string; title?: string }[]; dailyPages?: number } = {},
): OwnSiteDeps {
  let n = 0;
  return {
    getClient: async () => ({ id: "b1", kind: "own_brand", homepageUrl: HOME, ownSiteMappedAt: store.mappedAt }),
    getLimits: async () => ({ dailyPages: opts.dailyPages ?? 50, maxPages: 300 }),
    listPages: async () => store.pages.map((p) => ({ ...p })),
    map: async () =>
      opts.links ?? [
        { url: "https://www.waters.com/nextgen/us/en/products/lc.html", title: "LC" },
        { url: "https://www.waters.com/nextgen/us/en/careers.html" },
      ],
    insertPages: async (_ws, _b, rows) => {
      for (const r of rows) {
        store.pages.push({
          id: `p${++n}`,
          url: r.url,
          title: r.title,
          priority: r.priority,
          status: "queued",
          contentHash: null,
          etag: null,
          lastModified: null,
          changeDetectedAt: null,
          lastReadAt: null,
          lastCheckedAt: null,
          updatedAt: NOW,
        });
      }
    },
    updatePage: async (_ws, id, patch) => {
      const page = store.pages.find((p) => p.id === id)!;
      Object.assign(page, patch);
    },
    markGone: async (_ws, ids) => {
      for (const p of store.pages) if (ids.includes(p.id)) p.status = "gone";
    },
    recordMap: async (_ws, _b, o) => {
      if (o.mappedAt) store.mappedAt = o.mappedAt;
      store.mapError = o.error;
    },
    probe: async () => ({ outcome: "changed", etag: "e1", lastModified: null }),
    scrape: async (url) => {
      store.scrapes.push(url);
      return { url, title: "Page", markdown: `# ${url}\n\nWaters sells liquid chromatography systems for ${url}.` };
    },
    embed: async (texts) => texts.map(() => [0.1, 0.2]),
    hash: (t) => `h:${t.length}:${t.slice(-20)}`,
    writeChunks: async ({ page, chunks }) => {
      for (const c of chunks) store.chunks.push({ pageId: page.id, content: c.content });
    },
    retireChunks: async (_ws, ids) => {
      store.retired.push(...ids);
    },
    now: () => NOW,
    ...over,
  };
}

const emptyStore = (): Store => ({ pages: [], chunks: [], retired: [], mappedAt: null, mapError: null, scrapes: [] });

describe("runOwnSitePass", () => {
  it("first pass: lists the site, keeps the homepage, drops noise, reads pages into chunks", async () => {
    const store = emptyStore();
    const result = await runOwnSitePass(fakeDeps(store), { workspaceId: "ws", brandId: "b1" });
    expect(result).toMatchObject({ status: "done", added: 2, read: 2, failed: 0, mapped: 2 });
    expect(store.pages.map((p) => p.url)).toEqual([HOME, "https://www.waters.com/nextgen/us/en/products/lc.html"]);
    expect(store.pages.every((p) => p.status === "read" && p.etag === "e1")).toBe(true);
    expect(store.chunks.length).toBeGreaterThan(0);
    expect(store.mappedAt).toEqual(NOW);
  });

  it("second pass the same day: nothing re-listed, nothing re-read, no credits", async () => {
    const store = emptyStore();
    await runOwnSitePass(fakeDeps(store), { workspaceId: "ws", brandId: "b1" });
    store.scrapes = [];
    const again = await runOwnSitePass(fakeDeps(store), { workspaceId: "ws", brandId: "b1" });
    expect(again).toMatchObject({ status: "done", mapped: null, read: 0, probed: 0 });
    expect(store.scrapes).toEqual([]);
  });

  it("respects the daily budget", async () => {
    const store = emptyStore();
    const links = Array.from({ length: 10 }, (_, i) => ({ url: `https://www.waters.com/nextgen/us/en/products/p${i}.html` }));
    const result = await runOwnSitePass(fakeDeps(store, {}, { links, dailyPages: 4 }), { workspaceId: "ws", brandId: "b1" });
    expect(result).toMatchObject({ read: 4, added: 11 });
    expect(store.pages.filter((p) => p.status === "queued")).toHaveLength(7);
  });

  it("a probe that says changed re-reads the page and replaces its chunks; same content is not re-embedded", async () => {
    const store = emptyStore();
    await runOwnSitePass(fakeDeps(store), { workspaceId: "ws", brandId: "b1" });
    const later = new Date(NOW.getTime() + 4 * 86_400_000);
    const chunksBefore = store.chunks.length;
    let embeds = 0;
    const result = await runOwnSitePass(
      fakeDeps(store, {
        now: () => later,
        probe: async (_u, prior) =>
          prior.etag === "e1" ? { outcome: "changed", etag: "e2", lastModified: null } : { outcome: "unsupported" },
        embed: async (texts) => {
          embeds += 1;
          return texts.map(() => [0.3]);
        },
      }),
      { workspaceId: "ws", brandId: "b1" },
    );
    expect(result).toMatchObject({ probed: 2, changed: 2, unchanged: 2, read: 0 });
    expect(embeds).toBe(0);
    expect(store.chunks.length).toBe(chunksBefore);
    expect(store.pages.every((p) => p.changeDetectedAt === null)).toBe(true);
  });

  it("a page that fails is recorded with its reason and does not fail the pass", async () => {
    const store = emptyStore();
    const result = await runOwnSitePass(
      fakeDeps(store, {
        scrape: async (url) => {
          if (url.includes("products")) throw new Error("Firecrawl: 404 page not found");
          return { url, markdown: "# Home\n\nWaters." };
        },
      }),
      { workspaceId: "ws", brandId: "b1" },
    );
    expect(result).toMatchObject({ read: 1, failed: 1 });
    const bad = store.pages.find((p) => p.url.includes("products"))!;
    expect(bad.status).toBe("failed");
    expect((bad as OwnSitePageRow & { error?: string }).error).toContain("404");
  });

  it("a rate limit defers the remaining reads without marking pages failed", async () => {
    const store = emptyStore();
    const links = Array.from({ length: 6 }, (_, i) => ({ url: `https://www.waters.com/nextgen/us/en/products/p${i}.html` }));
    let calls = 0;
    const limited = Object.assign(new Error("Firecrawl is rate-limiting right now (429)."), { status: 429 });
    const result = await runOwnSitePass(
      fakeDeps(
        store,
        {
          scrape: async (url) => {
            calls += 1;
            if (calls > 1) throw limited;
            return { url, markdown: "# A\n\nWaters." };
          },
        },
        { links },
      ),
      { workspaceId: "ws", brandId: "b1" },
    );
    expect(result).toMatchObject({ read: 1, failed: 0, rateLimited: true });
    expect(store.pages.filter((p) => p.status === "failed")).toEqual([]);
    expect(store.pages.filter((p) => p.status === "queued")).toHaveLength(6);
    expect(calls).toBeLessThanOrEqual(3);
  });

  it("an embedding outage keeps the text (no second credit) and leaves the vectors to the backfill", async () => {
    const store = emptyStore();
    const vectors: (number[] | null)[] = [];
    const result = await runOwnSitePass(
      fakeDeps(store, {
        embed: async () => null,
        writeChunks: async ({ page, chunks }) => {
          for (const c of chunks) {
            store.chunks.push({ pageId: page.id, content: c.content });
            vectors.push(c.embedding);
          }
        },
      }),
      { workspaceId: "ws", brandId: "b1" },
    );
    expect(result).toMatchObject({ read: 2, failed: 0 });
    expect((result as { unembedded: number }).unembedded).toBe(store.chunks.length);
    expect(vectors.every((v) => v === null)).toBe(true);
    expect(store.pages.every((p) => p.status === "read")).toBe(true);
  });

  it("a map failure keeps known pages and records the reason", async () => {
    const store = emptyStore();
    await runOwnSitePass(fakeDeps(store), { workspaceId: "ws", brandId: "b1" });
    const result = await runOwnSitePass(
      fakeDeps(store, {
        map: async () => {
          throw new Error("Firecrawl could not be reached");
        },
      }),
      { workspaceId: "ws", brandId: "b1", forceRemap: true },
    );
    expect(result).toMatchObject({ status: "done", mapError: "Firecrawl could not be reached" });
    expect(store.pages.filter((p) => p.status === "read")).toHaveLength(2);
    expect(store.mapError).toBe("Firecrawl could not be reached");
  });

  it("a page gone from the site is marked gone and its chunks retired", async () => {
    const store = emptyStore();
    await runOwnSitePass(fakeDeps(store), { workspaceId: "ws", brandId: "b1" });
    const lc = store.pages.find((p) => p.url.includes("products"))!;
    await runOwnSitePass(fakeDeps(store, {}, { links: [] }), { workspaceId: "ws", brandId: "b1", forceRemap: true });
    expect(lc.status).toBe("gone");
    expect(store.retired).toEqual([lc.id]);
  });

  it("never reads a competitor's site as first-party", async () => {
    const store = emptyStore();
    const result = await runOwnSitePass(
      fakeDeps(store, {
        getClient: async () => ({ id: "c", kind: "competitor", homepageUrl: "https://x.com", ownSiteMappedAt: null }),
      }),
      { workspaceId: "ws", brandId: "c" },
    );
    expect(result.status).toBe("skipped");
    expect(store.scrapes).toEqual([]);
  });
});

describe("dominantLocaleUrl", () => {
  it("picks the most common locale, English on a tie, null when none", () => {
    expect(
      dominantLocaleUrl([
        { url: "https://w.com/nextgen/us/en/a.html" },
        { url: "https://w.com/nextgen/us/en/b.html" },
        { url: "https://w.com/nextgen/au/en/a.html" },
        { url: "https://w.com/nextgen/de/de/a.html" },
      ]),
    ).toBe("https://w.com/nextgen/us/en/a.html");
    expect(dominantLocaleUrl([{ url: "https://w.com/de/x" }, { url: "https://w.com/en/x" }])).toBe("https://w.com/en/x");
    // Live waters.com: a big German application-note archive must not outvote English.
    expect(
      dominantLocaleUrl([
        ...Array.from({ length: 9 }, (_, i) => ({ url: `https://w.com/nextgen/at/de/library/n${i}.html` })),
        { url: "https://w.com/nextgen/us/en/products.html" },
      ]),
    ).toBe("https://w.com/nextgen/us/en/products.html");
    expect(dominantLocaleUrl([{ url: "https://w.com/fr/a" }, { url: "https://w.com/fr/b" }, { url: "https://w.com/de/a" }])).toBe(
      "https://w.com/fr/a",
    );
    expect(dominantLocaleUrl([{ url: "https://w.com/about" }])).toBeNull();
  });

  it("the pass drops other languages once the site shows its main locale", async () => {
    const store = emptyStore();
    await runOwnSitePass(
      fakeDeps(store, {}, {
        links: [
          { url: "https://www.waters.com/nextgen/us/en/products/a.html" },
          { url: "https://www.waters.com/nextgen/us/en/products/b.html" },
          { url: "https://www.waters.com/nextgen/cn/zh/products/a.html" },
        ],
      }),
      { workspaceId: "ws", brandId: "b1" },
    );
    expect(store.pages.some((p) => p.url.includes("/cn/zh/"))).toBe(false);
  });
});
