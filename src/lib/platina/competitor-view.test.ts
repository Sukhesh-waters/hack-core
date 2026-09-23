import { describe, expect, it } from "vitest";
import { buildCompetitorView, type CvSignal } from "./competitor-view";

const NOW = new Date("2026-09-23T10:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const client = { id: "w", name: "Waters", kind: "own_brand", homepageUrl: "https://www.waters.com" };
const agilent = { id: "a", name: "Agilent", kind: "competitor", homepageUrl: "https://www.agilent.com" };
const bruker = { id: "b", name: "Bruker", kind: "competitor", homepageUrl: null };

const sig = (brandId: string, topic: string, value: number, ago: number, i = 0): CvSignal => ({
  brandId,
  topic,
  region: "global",
  signalKind: "interest",
  value,
  observedAt: day(ago),
  sourceUrl: `https://li/${brandId}/${topic}/${ago}/${i}`,
});

const signals: CvSignal[] = [
  ...[1, 2, 3, 4].map((d) => sig("a", "pfas analysis", 1.5, d, d)),
  sig("b", "pfas analysis", 3.2, 2),
  sig("w", "mass spectrometry", 5.4, 3),
  sig("w", "mass spectrometry", 1.2, 5),
  sig("a", "gc-ms", 1.9, 6),
  { ...sig("a", "pfas analysis", 9, 1), signalKind: "pressure" },
];

const view = buildCompetitorView({
  client,
  competitors: [agilent, bruker],
  specs: [{ id: "s1", name: "Agilent · website", brandId: "a", kind: "competitor_site", lastSuccessAt: day(1), enabled: true }],
  docCounts: [
    { brandId: "a", sourceKind: "social_posts", n: 25, newest: day(1) },
    { brandId: "a", sourceKind: "competitor_site", n: 4, newest: day(0) },
    { brandId: "a", sourceKind: "press_release", n: 1, newest: day(3) },
  ],
  findings: [{ brandId: "a", title: "Agilent pushes PFAS", summary: "Four posts on PFAS in a week.", useCase: "competitor_change", createdAt: day(1), sourceUrl: "https://agilent.com/x" }],
  signals,
  events: [
    { id: "e1", name: "ARABLAB LIVE 2026", startsOn: "2026-10-26", country: "AE" },
    { id: "e0", name: "Old show", startsOn: "2026-01-01", country: "US" },
  ],
  participants: [
    { eventId: "e1", brandId: "b", evidence: "listed_exhibitor", sourceUrl: "https://t/list" },
    { eventId: "e0", brandId: "b", evidence: "listed_exhibitor", sourceUrl: "https://t/old" },
  ],
  now: NOW,
});

describe("buildCompetitorView (C8.2)", () => {
  it("counts what was collected per competitor, by kind, with the newest", () => {
    const a = view.cards.find((c) => c.id === "a")!;
    expect(a.collected).toEqual({ posts: 25, pages: 5, ads: 0, events: 0 });
    expect(a.lastCollectedAt).toEqual(day(0));
    expect(a.sources.map((s) => s.name)).toEqual(["Agilent · website"]);
    expect(a.findings[0].title).toBe("Agilent pushes PFAS");
  });

  it("shows what each competitor posts about and its strongest post, interest only", () => {
    const a = view.cards.find((c) => c.id === "a")!;
    expect(a.topics[0]).toEqual({ topic: "pfas analysis", posts: 4, median: 1.5 });
    expect(a.bestPost).toMatchObject({ topic: "gc-ms", value: 1.9 });
  });

  it("lists only upcoming events a competitor is going to", () => {
    expect(view.cards.find((c) => c.id === "b")!.going.map((g) => g.name)).toEqual(["ARABLAB LIVE 2026"]);
  });

  it("white space: competitors talk about PFAS, Waters does not; Waters alone on mass spectrometry", () => {
    expect(view.theyTalk[0]).toMatchObject({ topic: "pfas analysis", themPosts: 5, clientPosts: 0 });
    expect(view.theyTalk[0].them).toEqual([
      { name: "Agilent", posts: 4 },
      { name: "Bruker", posts: 1 },
    ]);
    expect(view.onlyClient[0]).toMatchObject({ topic: "mass spectrometry", clientPosts: 2, themPosts: 0 });
    expect(view.theyTalk.some((w) => w.topic === "gc-ms")).toBe(false);
  });

  it("paid ads never count as interest in the pattern layer", () => {
    expect(view.cards.find((c) => c.id === "a")!.topics[0].posts).toBe(4);
  });
});
