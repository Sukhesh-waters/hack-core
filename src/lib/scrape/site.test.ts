import { describe, expect, it, vi } from "vitest";
import {
  chunkMarkdown,
  localeOf,
  mapConcurrent,
  pickSitePages,
  readSite,
} from "./site";

describe("localeOf", () => {
  it("reads the common locale shapes, and nothing from a plain path", () => {
    expect(localeOf("https://www.waters.com/nextgen/in/en.html")).toEqual({ region: "in", language: "en" });
    expect(localeOf("https://x.com/nextgen/au/en/products/a.html")).toEqual({ region: "au", language: "en" });
    expect(localeOf("https://x.com/en-us/about")).toEqual({ language: "en", region: "us" });
    expect(localeOf("https://x.com/fr/produits")).toEqual({ language: "fr" });
    expect(localeOf("https://x.com/about-us")).toBeNull();
  });
});

describe("pickSitePages (shaped on the live waters.com map)", () => {
  const W = "https://www.waters.com";
  const links = [
    { url: `${W}/nextgen/au/en/about-waters.html`, title: "About Waters" },
    { url: `${W}/nextgen/us/en/about-waters.html`, title: "About Waters" },
    { url: `${W}/nextgen/cn/zh/about-waters.html`, title: "关于沃特世" },
    { url: `${W}/nextgen/fr/fr/produits.html`, title: "Produits" },
    { url: `${W}/nextgen/us/en/products/informatics-and-software/empower-cds.html`, title: "Empower CDS" },
    { url: `${W}/nextgen/au/en/shop/columns/186009887-xselect.html`, title: "Shop XSelect Column" },
    { url: `${W}/content/dam/waters/en/library/infographic.pdf` },
    { url: `${W}/nextgen/fr/fr.sitemap.xml` },
    { url: `${W}/nextgen/us/en/about-waters/careers.html`, title: "Careers" },
    { url: `${W}/nextgen/us/en/about-waters/corporate-governance/legal-and-privacy-notices/x.html` },
    { url: `${W}/nextgen/cn/zh/library/application-notes/2011/aqua.html` },
    { url: `${W}/nextgen/us/en/library/application-notes/2025/adc.html`, title: "UV-based spectral identity" },
    { url: "https://ir.waters.com/News--Events/newsroom/default.aspx", title: "Newsroom - Waters" },
    { url: "https://www.competitor.com/about", title: "About a competitor" },
    { url: `${W}/nextgen/in/en.html`, title: "Waters" },
  ];

  const picked = pickSitePages({
    startUrl: `${W}/`,
    referenceUrl: `${W}/nextgen/in/en.html`,
    links,
  });
  const urls = picked.map((p) => p.url);

  it("keeps one version of a page, in the pasted language", () => {
    expect(urls.filter((u) => u.includes("about-waters.html"))).toHaveLength(1);
    expect(urls.some((u) => u.includes("/cn/zh/") || u.includes("/fr/fr/"))).toBe(false);
  });

  it("drops shop SKUs, files, sitemaps, careers, legal, other sites and the pasted page itself", () => {
    for (const noise of ["/shop/", ".pdf", "sitemap", "careers", "legal", "competitor.com", "/in/en.html"]) {
      expect(urls.some((u) => u.includes(noise))).toBe(false);
    }
  });

  it("keeps the brand's own subdomains (an investor newsroom is the brand talking)", () => {
    expect(urls).toContain("https://ir.waters.com/News--Events/newsroom/default.aspx");
  });

  it("ranks the pages that describe the business first, deep technical notes last or not at all", () => {
    expect(urls[0]).toContain("about-waters");
    const adc = urls.indexOf(`${W}/nextgen/us/en/library/application-notes/2025/adc.html`);
    expect(adc === -1 || adc > urls.indexOf(`${W}/nextgen/us/en/products/informatics-and-software/empower-cds.html`)).toBe(true);
  });

  it("respects the page cap", () => {
    expect(pickSitePages({ startUrl: `${W}/`, links, max: 2 })).toHaveLength(2);
  });
});

describe("chunkMarkdown", () => {
  it("prefixes every chunk with page › section context", () => {
    const chunks = chunkMarkdown(
      "# Products\n\n## Empower CDS\n\nEmpower is the chromatography data system used in regulated labs worldwide.",
      "Empower Chromatography Data System | Waters",
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].startsWith("Empower Chromatography Data System › Products › Empower CDS\n\n")).toBe(true);
  });

  it("drops calls to action, bold markers and headings echoed as paragraphs", () => {
    const [chunk] = chunkMarkdown(
      "## Highlighting progress\n\nHighlighting progress\n\n**Strong execution** across instruments and service.\n\n- Learn More",
      "Waters Corporation : The Science of What's Possible",
    );
    expect(chunk).toBe("Waters Corporation › Highlighting progress\n\nStrong execution across instruments and service.");
  });

  it("treats a sentence-length heading as text, and never repeats a breadcrumb", () => {
    const long = "Waters is committed to accelerating the benefits of pioneering science to improve the world";
    const [chunk] = chunkMarkdown(`# Sustainability\n\n## Sustainability\n\n## ${long}\n\nMore detail.`, "Sustainability");
    expect(chunk.split("\n\n")[0]).toBe("Sustainability");
    expect(chunk).toContain(long);
  });

  it("does not store a paragraph another page of the same site already stored", () => {
    const seen = new Set<string>();
    const banner = "Waters Corporation has combined with BD Biosciences and Diagnostic Solutions to lead.";
    chunkMarkdown(`${banner}\n\nPage one text that is long enough to count here.`, "One", seen);
    const second = chunkMarkdown(`${banner}\n\nPage two has its own words.`, "Two", seen);
    expect(second.join(" ")).not.toContain("BD Biosciences");
    expect(second.join(" ")).toContain("Page two");
  });

  it("packs small sections together and splits oversized ones within the limit", () => {
    const md = Array.from({ length: 6 }, (_, i) => `## Part ${i}\n\nsection ${i} ${"word ".repeat(60)}`).join("\n\n");
    const chunks = chunkMarkdown(md, "Page", new Set(), 700);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 700)).toBe(true);
    const huge = chunkMarkdown(`## Big\n\n${"x".repeat(50)} ${"lorem ".repeat(400)}`, "Page", new Set(), 500);
    expect(huge.every((c) => c.length <= 500)).toBe(true);
  });
});

describe("mapConcurrent", () => {
  it("keeps input order and never exceeds the limit", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapConcurrent([30, 5, 20, 1, 10], 2, async (ms) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, ms));
      running--;
      return ms * 2;
    });
    expect(out).toEqual([60, 10, 40, 2, 20]);
    expect(peak).toBe(2);
  });
});

describe("readSite", () => {
  const md = (name: string) => `## ${name}\n\n${name} is described here in enough words to be a real paragraph.`;

  it("reads the pasted page and the picked pages; a page Firecrawl fails falls back to plain text", async () => {
    const scrape = vi.fn(async (url: string) => {
      if (url.includes("products")) throw new Error("Firecrawl is rate-limiting right now (429).");
      return { url, title: url.includes("about") ? "About" : "Home", markdown: md(url) };
    });
    const result = await readSite("https://acme.com/", {
      map: async () => [
        { url: "https://acme.com/about", title: "About" },
        { url: "https://acme.com/products", title: "Products" },
      ],
      scrape,
      readText: async () => ({ title: "Products", text: "Products text ".repeat(30) }),
      chunkText: (t) => [t],
    });
    expect(result.pages.map((p) => [p.url, p.via])).toEqual([
      ["https://acme.com/", "firecrawl"],
      ["https://acme.com/about", "firecrawl"],
      ["https://acme.com/products", "direct"],
    ]);
    expect(result.pages[2].chunks[0].startsWith("Products\n\n")).toBe(true);
  });

  it("a site that cannot be listed still ingests the pasted page, and says why", async () => {
    const result = await readSite("https://acme.com/", {
      map: async () => {
        throw new Error("Listing the site's pages took too long.");
      },
      scrape: async (url) => ({ url, title: "Home", markdown: md("Home") }),
      chunkText: (t) => [t],
    });
    expect(result.pages).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/could not list/);
  });

  it("a picked page that nothing can read is skipped, never fatal", async () => {
    const result = await readSite("https://acme.com/", {
      map: async () => [{ url: "https://acme.com/about", title: "About" }],
      scrape: async (url) => {
        if (url.includes("about")) throw new Error("blocked");
        return { url, title: "Home", markdown: md("Home") };
      },
      chunkText: (t) => [t],
    });
    expect(result.pages).toHaveLength(1);
    expect(result.skipped).toEqual([{ url: "https://acme.com/about", reason: "blocked" }]);
  });
});
