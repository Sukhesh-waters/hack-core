import { describe, expect, it, vi } from "vitest";
import { readInstagramPostMetrics } from "@/lib/connectors/metrics-read";
import { connectedEngagements, matchConnectedMetrics } from "./metrics-connected";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/crypto", () => ({ decryptSecret: (s: string) => s }));
vi.mock("@/db/queries/platina-learning", () => ({ listCreatives: vi.fn(), upsertMetricSnapshots: vi.fn() }));

const DAY = new Date("2026-09-22T00:00:00Z");

describe("matchConnectedMetrics", () => {
  const creatives = [
    { id: "c1", url: "https://www.instagram.com/p/ABC/", externalId: null },
    { id: "c2", url: null, externalId: "17890" },
  ];

  it("matches by link or platform id; unlogged posts are ignored", () => {
    const rows = matchConnectedMetrics(
      creatives,
      [
        { externalId: "1", permalink: "https://instagram.com/p/ABC", postedAt: null, likes: 10, comments: 2, reach: 400 },
        { externalId: "17890", permalink: null, postedAt: null, likes: 5 },
        { externalId: "999", permalink: "https://instagram.com/p/ZZZ", postedAt: null, likes: 50 },
      ],
      DAY,
      "connector:meta",
    );
    expect(rows.map((r) => [r.creativeId, r.engagements, r.reach])).toEqual([
      ["c1", 12, 400],
      ["c2", 5, null],
    ]);
    expect(rows[0]).toMatchObject({ source: "connector:meta", capturedAt: DAY, impressions: null });
  });

  it("engagements are null when no count is known (never 0)", () => {
    expect(connectedEngagements({ externalId: "x", permalink: null, postedAt: null })).toBeNull();
    expect(connectedEngagements({ externalId: "x", permalink: null, postedAt: null, likes: 0 })).toBe(0);
  });
});

describe("readInstagramPostMetrics (read-only Graph calls)", () => {
  it("reads media then insights, GET only, and survives an insights failure", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      if (url.includes("/media?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { id: "m1", permalink: "https://instagram.com/p/A", timestamp: "2026-09-20T10:00:00+0000", like_count: 7, comments_count: 1 },
              { id: "m2", like_count: 3 },
            ],
          }),
        };
      }
      if (url.includes("m1/insights")) {
        return { ok: true, status: 200, json: async () => ({ data: [{ name: "reach", values: [{ value: 300 }] }, { name: "saved", values: [{ value: 4 }] }] }) };
      }
      return { ok: false, status: 400, json: async () => ({}) };
    };
    const out = await readInstagramPostMetrics("ig1", "tok en", fetchImpl);
    expect(out[0]).toMatchObject({ externalId: "m1", reach: 300, saves: 4, likes: 7, comments: 1 });
    expect(out[0].postedAt?.toISOString()).toBe("2026-09-20T10:00:00.000Z");
    expect(out[1]).toMatchObject({ externalId: "m2", likes: 3 });
    expect(out[1].reach).toBeUndefined();
    expect(urls.every((u) => u.startsWith("https://graph.facebook.com/"))).toBe(true);
    expect(urls[0]).toContain("access_token=tok%20en");
  });

  it("a failed listing is an error, not an empty result", async () => {
    await expect(
      readInstagramPostMetrics("ig1", "t", async () => ({ ok: false, status: 190, json: async () => ({}) })),
    ).rejects.toThrow("listing failed (190)");
  });
});
