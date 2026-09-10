import { describe, expect, it, vi } from "vitest";
import { crawlDomain } from "./crawler";

// Helper to build a minimal HTML page with optional structured data
function buildHtml(opts?: {
  title?: string;
  body?: string;
  ogTitle?: string;
  jsonLd?: object;
  links?: string[];
}): string {
  const og = opts?.ogTitle
    ? `<meta property="og:title" content="${opts.ogTitle}" />`
    : "";
  const jsonLd = opts?.jsonLd
    ? `<script type="application/ld+json">${JSON.stringify(opts.jsonLd)}</script>`
    : "";
  const links = (opts?.links ?? [])
    .map((href) => `<a href="${href}">link</a>`)
    .join("");
  return `<html><head><title>${opts?.title ?? "Test"}</title>${og}${jsonLd}</head><body><p>${opts?.body ?? "content"}</p>${links}</body></html>`;
}

describe("crawlDomain", () => {
  it("crawls start page and returns enhanced result shape", async () => {
    const html = buildHtml({
      title: "Brand Page",
      body: "Our mission is to empower creators.",
      ogTitle: "Brand Page OG",
      jsonLd: { "@type": "Organization", name: "TestBrand" },
    });

    // Mock fetch: robots.txt (404), ai.txt (404), sitemap (404), then the page
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("robots.txt") || url.includes("ai.txt") || url.includes("sitemap.xml")) {
        return new Response("", { status: 404 });
      }
      return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html", "ETag": '"abc123"' },
      });
    });

    const pages = await crawlDomain("https://example.com", { maxPages: 1 });
    expect(pages).toHaveLength(1);
    expect(pages[0].title).toBe("Brand Page");
    expect(pages[0].content).toContain("empower creators");
    expect(pages[0].contentHash).toHaveLength(64); // SHA-256 hex
    expect(pages[0].etag).toBe('"abc123"');
    expect(pages[0].structured.ogTitle).toBe("Brand Page OG");
    expect(pages[0].structured.jsonLd).toHaveLength(1);
    expect((pages[0].structured.jsonLd![0] as { name: string }).name).toBe("TestBrand");
  });

  it("returns empty array when ai.txt blocks crawling", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("ai.txt")) {
        return new Response("User-Agent: *\nDisallow: /", { status: 200 });
      }
      return new Response("", { status: 404 });
    });

    const pages = await crawlDomain("https://example.com");
    expect(pages).toHaveLength(0);
  });

  it("skips disallowed paths from robots.txt", async () => {
    const robotsTxt = "User-Agent: *\nDisallow: /private/";
    const html = buildHtml({
      title: "Public",
      body: "public content",
      links: ["https://example.com/private/secret", "https://example.com/about"],
    });
    const aboutHtml = buildHtml({ title: "About", body: "about page" });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("robots.txt")) {
        return new Response(robotsTxt, { status: 200 });
      }
      if (url.includes("ai.txt") || url.includes("sitemap.xml")) {
        return new Response("", { status: 404 });
      }
      if (url.includes("/about")) {
        return new Response(aboutHtml, { status: 200, headers: { "Content-Type": "text/html" } });
      }
      return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
    });

    const pages = await crawlDomain("https://example.com", { maxPages: 10 });
    const urls = pages.map((p) => p.url);
    expect(urls).not.toContain("https://example.com/private/secret");
    expect(urls).toContain("https://example.com/about");
  });
});
