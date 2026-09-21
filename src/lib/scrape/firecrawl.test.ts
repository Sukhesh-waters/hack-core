import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ScrapeError,
  describeFirecrawlFailure,
  isUnsupportedByFirecrawl,
  scrapeWithFirecrawl,
} from "./firecrawl";

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const page = (overrides: Record<string, unknown> = {}) => ({
  success: true,
  data: {
    markdown: "# Waters\n\nNew LC system launched.",
    metadata: {
      title: "Waters",
      description: "The science of what's possible",
      url: "https://www.waters.com/nextgen/in/en.html",
      statusCode: 200,
      creditsUsed: 1,
    },
    ...overrides,
  },
});

beforeEach(() => {
  vi.stubEnv("FIRECRAWL_API_KEY", "fc-test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("scrapeWithFirecrawl", () => {
  it("returns markdown, the final URL and metadata; asks for markdown only by default (1 credit)", async () => {
    const fetchMock = vi.fn().mockImplementation(() => reply(page()));
    vi.stubGlobal("fetch", fetchMock);

    const result = await scrapeWithFirecrawl("https://www.waters.com/");
    expect(result.markdown).toContain("New LC system");
    expect(result.url).toBe("https://www.waters.com/nextgen/in/en.html");
    expect(result.title).toBe("Waters");
    expect(result.creditsUsed).toBe(1);
    expect(result.json).toBeUndefined();

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.formats).toEqual(["markdown"]);
    expect(body.onlyMainContent).toBe(true);
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe("Bearer fc-test");
  });

  it("adds a JSON-schema format only when asked, and returns the extraction", async () => {
    const fetchMock = vi.fn().mockImplementation(() => reply(page({ json: { headline: "LC" } })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await scrapeWithFirecrawl("https://www.waters.com/", {
      jsonSchema: { type: "object" },
      jsonPrompt: "extract",
      maxAgeMs: 600_000,
    });
    expect(result.json).toEqual({ headline: "LC" });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.formats[1]).toEqual({ type: "json", schema: { type: "object" }, prompt: "extract" });
    expect(body.maxAge).toBe(600_000);
  });

  it("refuses social platforms without spending a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(scrapeWithFirecrawl("https://www.instagram.com/acreshub/")).rejects.toMatchObject({
      name: "ScrapeError",
      retryable: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("without a key it fails clearly and retryably (another scraper may still work)", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "");
    await expect(scrapeWithFirecrawl("https://example.com")).rejects.toMatchObject({
      message: "FIRECRAWL_API_KEY is not set.",
      retryable: true,
    });
  });

  it("used-up credits are retryable elsewhere and say so", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => reply({ success: false, error: "Payment required" }, 402)));
    const error = await scrapeWithFirecrawl("https://example.com").catch((e) => e);
    expect(error).toBeInstanceOf(ScrapeError);
    expect(error.retryable).toBe(true);
    expect(error.message).toMatch(/credits are used up/);
  });

  it("a target page that answers 404 is not a page, and no other scraper will change that", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => reply(page({ metadata: { statusCode: 404 } }))),
    );
    const error = await scrapeWithFirecrawl("https://example.com/gone").catch((e) => e);
    expect(error.message).toBe("The page answered 404.");
    expect(error.retryable).toBe(false);
  });

  it("an empty page is a failure, never an empty document", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => reply(page({ markdown: "  " }))));
    await expect(scrapeWithFirecrawl("https://example.com")).rejects.toMatchObject({
      message: "Firecrawl returned an empty page.",
    });
  });

  it("a network failure or timeout is retryable, with a readable message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(scrapeWithFirecrawl("https://example.com")).rejects.toMatchObject({
      message: "Firecrawl could not be reached (network error).",
      retryable: true,
    });
  });
});

describe("failure descriptions", () => {
  it("names the fix for each status", () => {
    expect(describeFirecrawlFailure(401, "").message).toMatch(/FIRECRAWL_API_KEY/);
    expect(describeFirecrawlFailure(429, "").retryable).toBe(true);
    expect(describeFirecrawlFailure(403, "we do not support this site").message).toMatch(/social/);
    expect(describeFirecrawlFailure(503, "").retryable).toBe(true);
    expect(describeFirecrawlFailure(400, "bad url").retryable).toBe(false);
  });

  it("recognises social hosts, including subdomains, and nothing else", () => {
    expect(isUnsupportedByFirecrawl("https://www.instagram.com/x")).toBe(true);
    expect(isUnsupportedByFirecrawl("https://m.facebook.com/x")).toBe(true);
    expect(isUnsupportedByFirecrawl("https://tiktok.com/@x")).toBe(true);
    expect(isUnsupportedByFirecrawl("https://www.waters.com/")).toBe(false);
    expect(isUnsupportedByFirecrawl("https://notinstagram.com/")).toBe(false);
    expect(isUnsupportedByFirecrawl("not a url")).toBe(false);
  });
});
