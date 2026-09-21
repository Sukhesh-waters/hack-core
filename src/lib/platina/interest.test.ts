import { describe, expect, it, vi } from "vitest";
import {
  MIN_INTEREST_N,
  adPressureSignals,
  clientTopics,
  engagementOf,
  socialInterestSignals,
  topicMomentum,
  topicsByKeyword,
  type SocialDoc,
} from "./interest";
import { adStartedAt, channelOf, extractInterestForClient, isBrandsOwnItem } from "./interest-extract";
import { assignTopics, normaliseTheme, parseTopicReply } from "./interest-topics";

const NOW = new Date("2026-09-21T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe("client topics", () => {
  it("comes from the client's own profile, minus its name and generic words", () => {
    expect(
      clientTopics(
        { offers: ["Liquid Chromatography", "software", "services", "mass spectrometry"], keywords: ["Waters", "LC-MS", "mass spectrometry"] },
        "Waters",
      ),
    ).toEqual(["liquid chromatography", "mass spectrometry", "lc-ms"]);
  });

  it("matches whole phrases only (and simple plurals)", () => {
    const topics = ["mass spectrometry", "lc"];
    expect(topicsByKeyword("New mass spectrometry workflows for GLP-1", topics)).toEqual(["mass spectrometry"]);
    expect(topicsByKeyword("Our clinical teams", topics)).toEqual([]);
  });
});

describe("interest is measured against each company's own typical post", () => {
  const post = (id: string, brandId: string, likes: number, topic: string, age = 5): SocialDoc & { topic: string } => ({
    id,
    brandId,
    canonicalUrl: `https://www.linkedin.com/posts/${id}`,
    sourceUrl: `linkedin:@${brandId}`,
    body: topic,
    metrics: { likes, comments: 0, shares: 0, postedAt: daysAgo(age) },
    topic,
  });

  it("a big company's ordinary post and a small company's ordinary post score the same", () => {
    const docs = [
      post("t1", "thermo", 600, "glp-1"), post("t2", "thermo", 300, "x"), post("t3", "thermo", 300, "x"),
      post("w1", "waters", 60, "glp-1"), post("w2", "waters", 30, "x"), post("w3", "waters", 30, "x"),
    ];
    const signals = socialInterestSignals("ws", docs, (d) => [(d as SocialDoc & { topic: string }).topic]);
    const glp = signals.filter((s) => s.topic === "glp-1").map((s) => s.value);
    expect(glp).toEqual([2, 2]); // both 2x their company's median, despite 10x raw difference
    expect(signals[0].detail).toMatchObject({ engagement: 600, companyMedian: 300 });
  });

  it("a company with fewer than 3 measured posts produces nothing (no median of one)", () => {
    const docs = [post("a", "tiny", 50, "glp-1"), post("b", "tiny", 10, "glp-1")];
    expect(socialInterestSignals("ws", docs, () => ["glp-1"])).toEqual([]);
  });

  it("an unmeasured post is not a zero", () => {
    expect(engagementOf(null)).toBeNull();
    expect(engagementOf({ likes: 0 })).toBe(0);
  });
});

describe("ads are pressure, not interest", () => {
  it("scores days running, per country, and skips ads with no start date", () => {
    const signals = adPressureSignals(
      "ws",
      [
        { id: "a", brandId: "thermo", canonicalUrl: "u", sourceUrl: "s", body: "qPCR", startedAt: new Date(daysAgo(60)), countries: ["AE", "SA"] },
        { id: "b", brandId: "thermo", canonicalUrl: "u2", sourceUrl: "s", body: "qPCR", startedAt: null, countries: [] },
      ],
      () => ["qpcr"],
      "meta_ads",
      NOW,
    );
    expect(signals.map((s) => [s.region, s.value, s.signalKind])).toEqual([
      ["AE", 60, "pressure"],
      ["SA", 60, "pressure"],
    ]);
  });

  it("reads both start-date shapes the actor emits", () => {
    expect(adStartedAt({ start_date: 1782000000 })?.toISOString()).toBe("2026-06-21T00:00:00.000Z");
    expect(adStartedAt({ start_date_formatted: "2026-03-31 07:00:00" })?.toISOString()).toBe("2026-03-31T07:00:00.000Z");
    expect(adStartedAt({})).toBeNull();
  });

  it("an ad from another advertiser (the 'Waters' keyword boats) never counts", () => {
    const q = "https://www.facebook.com/ads/library/?q=Waters";
    const base = { id: "x", brandId: "w", sourceKind: "ad_library", sourceUrl: q, canonicalUrl: null, body: "", metrics: null };
    expect(isBrandsOwnItem({ ...base, raw: { page_name: "Blue Dolphin Charters" } })).toBe(false);
    expect(isBrandsOwnItem({ ...base, raw: { page_name: "Waters Corporation" } })).toBe(true);
    expect(isBrandsOwnItem({ ...base, sourceKind: "social_posts", raw: null })).toBe(true);
  });

  it("knows the channel from the source", () => {
    expect(channelOf("linkedin:@waters")).toBe("linkedin");
    expect(channelOf("https://www.facebook.com/ads/library/?q=x")).toBe("meta_ads");
  });
});

describe("momentum", () => {
  const sig = (topic: string, value: number, age: number) => ({
    topic,
    region: "global",
    signalKind: "interest" as const,
    value,
    observedAt: new Date(daysAgo(age)),
    sourceUrl: `https://x/${topic}/${age}`,
  });

  it("compares the last 30 days with the 90 before, and shows the strongest proofs", () => {
    const rows = [sig("glp-1", 3, 3), sig("glp-1", 2, 10), sig("glp-1", 2.5, 20), sig("glp-1", 1, 50), sig("glp-1", 1, 80)];
    const [m] = topicMomentum(rows, NOW);
    expect(m).toMatchObject({ topic: "glp-1", recent: 2.5, baseline: 1, change: 1.5, n: 5, status: "ok" });
    expect(m.proofs[0]).toMatchObject({ value: 3, sourceUrl: "https://x/glp-1/3" });
  });

  it(`below ${MIN_INTEREST_N} data points it says 'insufficient', never a trend`, () => {
    const [m] = topicMomentum([sig("hplc", 9, 2), sig("hplc", 8, 3)], NOW);
    expect(m.status).toBe("insufficient");
  });

  it("ranks interest before pressure and 'ok' before 'insufficient'", () => {
    const rows = [
      { ...sig("ads-topic", 90, 2), signalKind: "pressure" as const },
      sig("thin", 9, 1),
      ...[1, 2, 3, 4, 5].map((d) => sig("solid", 1.2, d)),
    ];
    expect(topicMomentum(rows, NOW).map((m) => m.topic)).toEqual(["solid", "thin", "ads-topic"]);
  });
});

describe("topic assignment", () => {
  it("keeps only listed topics plus one well-formed theme", () => {
    const reply = JSON.stringify({
      items: [
        { i: 0, topics: ["Mass Spectrometry", "made up"], theme: "GLP-1 development" },
        { i: 1, topics: [], theme: "none" },
        { i: 9, topics: ["mass spectrometry"] },
      ],
    });
    expect(parseTopicReply(reply, 2, ["mass spectrometry"])).toEqual([["mass spectrometry", "glp-1 development"], []]);
    expect(normaliseTheme("a theme that is far too long to be a short market theme label")).toBeNull();
  });

  it("asks the model only for texts no keyword matched, and survives its failure", async () => {
    const ask = vi.fn(async () => JSON.stringify({ items: [{ i: 0, topics: [], theme: "lab automation" }] }));
    const out = await assignTopics(["mass spectrometry news", "robots in the lab"], ["mass spectrometry"], ask);
    expect(out).toEqual([["mass spectrometry"], ["lab automation"]]);
    expect(ask).toHaveBeenCalledOnce();
    const failing = await assignTopics(["robots"], ["mass spectrometry"], async () => {
      throw new Error("down");
    });
    expect(failing).toEqual([[]]);
  });
});

describe("extractInterestForClient", () => {
  it("needs a client profile, then measures client + competitors and inserts", async () => {
    const insert = vi.fn(async (rows: unknown[]) => rows.length);
    const docs = ["a", "b", "c"].map((id, i) => ({
      id,
      brandId: "thermo",
      sourceKind: "social_posts",
      sourceUrl: "linkedin:@thermo",
      canonicalUrl: `https://li/${id}`,
      body: "mass spectrometry",
      metrics: { likes: [10, 20, 30][i], postedAt: daysAgo(3) },
      raw: null,
    }));
    const result = await extractInterestForClient(
      {
        getClient: async () => ({ id: "waters", name: "Waters", kind: "own_brand", profile: { summary: "", offers: ["mass spectrometry"], audience: "", tone: "", keywords: [], claims: [] } }),
        listCompetitorIds: async () => ["thermo"],
        listDocs: async (_ws, ids) => (ids.includes("thermo") ? docs : []),
        assign: async (texts, topics) => texts.map(() => [topics[0]]),
        insert,
      },
      { workspaceId: "ws", clientId: "waters", now: NOW },
    );
    expect(result).toMatchObject({ status: "done", docs: 3, signals: 3, inserted: 3 });

    const noProfile = await extractInterestForClient(
      {
        getClient: async () => ({ id: "w", name: "W", kind: "own_brand", profile: null }),
        listCompetitorIds: async () => [],
        listDocs: async () => [],
        assign: async () => [],
        insert,
      },
      { workspaceId: "ws", clientId: "w", now: NOW },
    );
    expect(noProfile).toMatchObject({ status: "skipped" });
  });
});

describe("momentum is robust to one viral post (live 2026-09-21)", () => {
  it("uses the median, and still shows the viral post as the top proof", () => {
    const rows = [1, 1.1, 0.9, 1.2, 18.29].map((value, i) => ({
      topic: "mass spectrometry",
      region: "global",
      signalKind: "interest",
      value,
      observedAt: new Date(NOW.getTime() - (i + 1) * 86_400_000),
      sourceUrl: `https://x/${i}`,
    }));
    const [m] = topicMomentum(rows, NOW);
    expect(m.recent).toBe(1.1);
    expect(m.proofs[0].value).toBe(18.29);
  });

  it("does not take generic profile words as topics", () => {
    expect(clientTopics({ offers: ["analytical systems", "service offerings", "mass spectrometry"] }, "Waters")).toEqual([
      "mass spectrometry",
    ]);
  });
});
