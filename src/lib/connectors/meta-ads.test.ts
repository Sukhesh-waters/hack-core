import { describe, expect, it } from "vitest";
import { metricsFromInsight, pullMetaCampaignMetrics } from "./meta-ads";

describe("pullMetaCampaignMetrics never invents numbers", () => {
  it("no token or no Meta campaign id: not connected, no fetch", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch;
    for (const input of [
      { metaCampaignId: null, accessToken: "EAAx" },
      { metaCampaignId: "123", accessToken: null },
    ]) {
      const res = await pullMetaCampaignMetrics({ ...input, fetchImpl });
      expect(res.status).toBe("not_connected");
    }
    expect(called).toBe(false);
  });

  it("a failed or empty Meta answer returns no metrics", async () => {
    const failing = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    expect((await pullMetaCampaignMetrics({ metaCampaignId: "1", accessToken: "t", fetchImpl: failing })).status).toBe("error");
    const throwing = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect((await pullMetaCampaignMetrics({ metaCampaignId: "1", accessToken: "t", fetchImpl: throwing })).status).toBe("error");
    const empty = (async () => new Response(JSON.stringify({ data: [] }))) as typeof fetch;
    expect((await pullMetaCampaignMetrics({ metaCampaignId: "1", accessToken: "t", fetchImpl: empty })).status).toBe("no_data");
  });

  it("sends the token in the Authorization header, never the URL", async () => {
    let seenUrl = "";
    let seenAuth = "";
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seenUrl = url;
      seenAuth = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(JSON.stringify({ data: [{ spend: "10", impressions: "1000", clicks: "20" }] }));
    }) as unknown as typeof fetch;
    const res = await pullMetaCampaignMetrics({ metaCampaignId: "123", accessToken: "EAAsecret", fetchImpl });
    expect(res.status).toBe("ok");
    expect(seenUrl).not.toContain("EAAsecret");
    expect(seenAuth).toBe("Bearer EAAsecret");
  });
});

describe("metricsFromInsight", () => {
  it("counts only leads and conversions, not clicks, engagement or video views", () => {
    const m = metricsFromInsight({
      spend: "100",
      impressions: "10000",
      clicks: "200",
      actions: [
        { action_type: "link_click", value: "180" },
        { action_type: "post_engagement", value: "400" },
        { action_type: "video_view", value: "900" },
        { action_type: "lead", value: "4" },
        { action_type: "offsite_conversion.fb_pixel_lead", value: "1" },
      ],
    });
    expect(m).toEqual({ spend: 100, impressions: 10000, clicks: 200, conversions: 5, ctr: 2, cpc: 0.5, cpa: 20 });
  });
});
