import { describe, expect, it } from "vitest";
import { deriveSources } from "./derive";
import { discoverCandidates, type Discovered } from "./discover";
import {
  candidateFromId,
  enrichFromSitemap,
  kindForSection,
  parseSitemap,
  sectionsFromSitemap,
} from "./sitemap";

const ORIGIN = "https://acme.com";
const urlset = (entries: string[]) =>
  `<?xml version="1.0"?><urlset>${entries.join("")}</urlset>`;
const url = (loc: string, lastmod?: string) =>
  `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;

describe("parseSitemap", () => {
  it("reads locs and lastmods, decoding entities", () => {
    const xml = urlset([url("https://acme.com/blog/a?x=1&amp;y=2", "2026-09-01"), url("https://acme.com/blog/b")]);
    const { entries, childSitemaps } = parseSitemap(xml);
    expect(entries).toEqual([
      { loc: "https://acme.com/blog/a?x=1&y=2", lastmod: "2026-09-01" },
      { loc: "https://acme.com/blog/b", lastmod: null },
    ]);
    expect(childSitemaps).toEqual([]);
  });

  it("separates a sitemap index's children from page entries", () => {
    const xml = `<sitemapindex><sitemap><loc>https://acme.com/s1.xml</loc></sitemap></sitemapindex>`;
    expect(parseSitemap(xml)).toEqual({ entries: [], childSitemaps: ["https://acme.com/s1.xml"] });
  });

  it("returns empty lists for junk instead of throwing", () => {
    expect(parseSitemap("<html>not a sitemap</html>")).toEqual({ entries: [], childSitemaps: [] });
    expect(parseSitemap("")).toEqual({ entries: [], childSitemaps: [] });
  });
});

describe("sectionsFromSitemap", () => {
  const entries = [
    ...["a", "b", "c", "d"].map((s) => ({ loc: `${ORIGIN}/blog/${s}`, lastmod: `2026-09-0${"abcd".indexOf(s) + 1}` })),
    ...["x", "y", "z"].map((s) => ({ loc: `${ORIGIN}/news/${s}`, lastmod: null })),
    { loc: `${ORIGIN}/`, lastmod: null },
    { loc: `${ORIGIN}/about`, lastmod: null },
    { loc: `https://other.com/blog/a`, lastmod: null },
    { loc: `${ORIGIN}/en-gb/blog/e`, lastmod: null },
  ];

  it("counts pages per first path segment, newest lastmod wins, cross-origin ignored", () => {
    const sections = sectionsFromSitemap(entries, ORIGIN);
    expect(sections[0]).toEqual({ path: "/blog", count: 5, lastmod: "2026-09-04" });
    expect(sections.find((s) => s.path === "/news")?.count).toBe(3);
  });

  it("treats a locale prefix as transparent and ignores the root and single-segment pages", () => {
    const sections = sectionsFromSitemap(entries, ORIGIN);
    expect(sections.some((s) => s.path === "/en-gb")).toBe(false);
    expect(sections.some((s) => s.path === "/about")).toBe(false);
  });
});

describe("kindForSection", () => {
  it.each([
    ["/news", "press_release"],
    ["/Press", "press_release"],
    ["/blog", "trade_editorial"],
    ["/insights", "trade_editorial"],
    ["/events", "conference"],
  ])("%s -> %s", (path, kind) => expect(kindForSection(path)).toBe(kind));

  it("does not guess for sections whose name says nothing", () => {
    expect(kindForSection("/products")).toBeNull();
    expect(kindForSection("/careers")).toBeNull();
  });
});

describe("candidateFromId (approval re-validation)", () => {
  it("accepts a one-segment section on the client's own origin", () => {
    expect(candidateFromId(`press_release:${ORIGIN}/news`, ORIGIN)).toMatchObject({
      kind: "press_release",
      value: `${ORIGIN}/news`,
      maxPages: 3,
    });
  });

  it.each([
    ["another origin", `press_release:https://evil.com/news`],
    ["a query string", `press_release:${ORIGIN}/news?x=1`],
    ["a deep path", `press_release:${ORIGIN}/news/a/b`],
    ["the bare root", `press_release:${ORIGIN}/`],
    ["an unlisted kind", `competitor_site:${ORIGIN}/news`],
    ["no kind", `${ORIGIN}/news`],
    ["garbage", `press_release:not a url`],
  ])("refuses %s", (_label, id) => {
    expect(candidateFromId(id, ORIGIN)).toBeNull();
  });
});

describe("enrichFromSitemap", () => {
  const candidates = deriveSources({ homepageUrl: "acme.com", handles: {} });
  const status = (paths: string[]): Promise<Discovered[]> =>
    discoverCandidates(candidates, async (u) => ({
      status: paths.includes(u) ? 200 : 404,
      headers: { get: () => null },
    }));

  const sitemap = urlset([
    ...["a", "b", "c"].map((s) => url(`${ORIGIN}/blog/${s}`, "2026-09-10")),
    ...["a", "b", "c", "d"].map((s) => url(`${ORIGIN}/media/${s}`)),
    ...["a", "b", "c"].map((s) => url(`${ORIGIN}/products/${s}`)),
  ]);

  it("confirms a guessed section with its real page count and date", async () => {
    const found = await status([`${ORIGIN}/sitemap.xml`]);
    const out = await enrichFromSitemap(found, ORIGIN, async () => sitemap);
    const blog = out.find((c) => c.value === `${ORIGIN}/blog`)!;
    expect(blog).toMatchObject({ exists: true, confidence: "likely" });
    expect(blog.reason).toBe("3 pages in the sitemap, last updated 2026-09-10.");
  });

  it("adds a real section the guesses missed, but only one whose name says what it is", async () => {
    const found = await status([`${ORIGIN}/sitemap.xml`]);
    const out = await enrichFromSitemap(found, ORIGIN, async () => sitemap);
    expect(out.find((c) => c.value === `${ORIGIN}/media`)).toMatchObject({ kind: "press_release", exists: true });
    expect(out.some((c) => c.value === `${ORIGIN}/products`)).toBe(false);
  });

  it("leaves the list untouched when there is no sitemap, it fails, or it is not XML", async () => {
    const none = await status([]);
    expect(await enrichFromSitemap(none, ORIGIN, async () => sitemap)).toEqual(none);
    const found = await status([`${ORIGIN}/sitemap.xml`]);
    expect(await enrichFromSitemap(found, ORIGIN, async () => null)).toEqual(found);
    expect(await enrichFromSitemap(found, ORIGIN, async () => { throw new Error("boom"); })).toEqual(found);
    expect(await enrichFromSitemap(found, ORIGIN, async () => "<html/>")).toEqual(found);
  });

  it("never follows a child sitemap on another origin", async () => {
    const index = `<sitemapindex><sitemap><loc>https://evil.com/s.xml</loc></sitemap></sitemapindex>`;
    const fetched: string[] = [];
    await enrichFromSitemap(await status([`${ORIGIN}/sitemap.xml`]), ORIGIN, async (u) => {
      fetched.push(u);
      return u.endsWith("sitemap.xml") && u.startsWith(ORIGIN) ? index : sitemap;
    });
    expect(fetched.some((u) => u.includes("evil.com"))).toBe(false);
  });

  it("never touches social sources", async () => {
    const withSocial = deriveSources({ homepageUrl: "acme.com", handles: { instagram: "acme" } });
    const found = await discoverCandidates(withSocial, async (u) => ({
      status: u === `${ORIGIN}/sitemap.xml` ? 200 : 404,
      headers: { get: () => null },
    }));
    const out = await enrichFromSitemap(found, ORIGIN, async () => sitemap);
    expect(out.filter((c) => c.kind.startsWith("social_")).map((c) => c.exists)).toEqual([null, null]);
  });
});
