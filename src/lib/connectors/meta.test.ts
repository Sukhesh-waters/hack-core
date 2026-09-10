import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaConnectorError, pullMetaMedia } from "./meta";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

const MEDIA_PAYLOAD = {
  data: [
    {
      id: "m1",
      caption: "Our launch",
      timestamp: "2026-06-01T10:00:00+0000",
      media_type: "REEL",
      like_count: 120,
      comments_count: 8,
    },
  ],
};

describe("pullMetaMedia", () => {
  it("maps media + insights into ParsedPostRow shape (first-party layer input)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(MEDIA_PAYLOAD))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { name: "reach", values: [{ value: 4000 }] },
            { name: "saved", values: [{ value: 25 }] },
            { name: "shares", values: [{ value: 10 }] },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const rows = await pullMetaMedia("ig_user_1", "token");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      externalId: "m1",
      caption: "Our launch",
      likes: 120,
      comments: 8,
      reach: 4000,
      saves: 25,
      shares: 10,
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain("graph.facebook.com");
  });

  it("keeps the row without reach when insights fail — unscored, not fabricated", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(MEDIA_PAYLOAD))
      .mockResolvedValueOnce(jsonResponse({ error: "denied" }, 403));
    vi.stubGlobal("fetch", fetchMock);

    const rows = await pullMetaMedia("ig_user_1", "token");
    expect(rows).toHaveLength(1);
    expect(rows[0].reach).toBeUndefined();
  });

  it("throws MetaConnectorError when the media listing fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "bad token" }, 401)),
    );
    await expect(pullMetaMedia("u", "t")).rejects.toBeInstanceOf(
      MetaConnectorError,
    );
  });
});
