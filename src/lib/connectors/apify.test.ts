import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApifyError, fetchPublicPosts } from "./apify";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => vi.stubEnv("APIFY_TOKEN", "apify_api_test"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fetchPublicPosts", () => {
  it("runs the Instagram scraper actor and maps items to pattern items", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          id: "abc123",
          caption: "Competitor launch post",
          timestamp: "2026-06-20T10:00:00.000Z",
          likesCount: 512,
          commentsCount: 33,
          type: "Video",
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const items = await fetchPublicPosts("competitor.coffee");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      externalId: "abc123",
      caption: "Competitor launch post",
      likes: 512,
      comments: 33,
      format: "video",
    });
    expect(items[0].postedAt.getUTCFullYear()).toBe(2026);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("api.apify.com");
    expect(url).toContain("instagram-scraper");
  });

  it("skips items without a usable timestamp", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([
          { id: "1", caption: "no date" },
          { id: "2", caption: "ok", timestamp: "2026-06-01T00:00:00Z" },
        ]),
      ),
    );
    const items = await fetchPublicPosts("page");
    expect(items).toHaveLength(1);
    expect(items[0].externalId).toBe("2");
  });

  it("throws ApifyError without a token", async () => {
    vi.stubEnv("APIFY_TOKEN", "");
    vi.stubGlobal("fetch", vi.fn());
    await expect(fetchPublicPosts("page")).rejects.toBeInstanceOf(ApifyError);
  });

  it("throws ApifyError on a failed run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "quota" }, 402)),
    );
    await expect(fetchPublicPosts("page")).rejects.toBeInstanceOf(ApifyError);
  });
});
