import { describe, expect, it } from "vitest";
import { buildBrainMap, layout3d, type BrainMapInput } from "./brain-map";

const input: BrainMapInput = {
  client: { id: "w", name: "Waters" },
  competitors: [
    { id: "a", name: "Agilent" },
    { id: "b", name: "Bruker" },
  ],
  insights: [
    { id: "i1", content: "Posts on pfas analysis drew 1.5x typical engagement.", insightKey: "interest:w:pfas analysis", sourceSignalIds: ["d1"], agreementState: "agreed" },
    { id: "i2", content: "ARABLAB LIVE 2026 runs 26-28 October in Dubai.", insightKey: "event:arablab-2026", sourceSignalIds: [], agreementState: "agreed" },
    { id: "i3", content: "Agilent is pushing gc-ms workflows for air analysis.", insightKey: null, sourceSignalIds: ["d2"], agreementState: "qualified" },
    { id: "i4", content: "An insight resting on nothing we can show.", insightKey: null, sourceSignalIds: ["gone"], agreementState: "agreed" },
  ],
  documents: [
    { id: "d1", brandId: "a", sourceKind: "social_posts", sourceUrl: "https://www.linkedin.com/posts/agilent_1", title: "Agilent PFAS post" },
    { id: "d2", brandId: "a", sourceKind: "competitor_site", sourceUrl: "https://www.agilent.com/gcms", title: null },
  ],
  topics: [
    { brandId: "a", topic: "pfas analysis", posts: 4 },
    { brandId: "a", topic: "gc-ms", posts: 2 },
    { brandId: "b", topic: "lonely topic", posts: 0 },
  ],
  events: [{ id: "e1", eventKey: "arablab-2026", name: "ARABLAB LIVE 2026", startsOn: "2026-10-26" }],
  participants: [{ eventId: "e1", brandId: "b", evidence: "listed_exhibitor" }],
};

describe("buildBrainMap (C8.6)", () => {
  const map = buildBrainMap(input);
  const has = (a: string, b: string) => map.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));

  it("connects companies, subjects, events, sources and insights, each link with a sentence", () => {
    expect(has("brand:a", "brand:w")?.sentence).toBe("Agilent competes with Waters");
    expect(has("brand:a", "topic:pfas analysis")?.sentence).toBe("Agilent posted 4 times on pfas analysis");
    expect(has("brand:b", "event:e1")?.sentence).toBe("Bruker is going: on the exhibitor list");
    expect(has("insight:i1", "doc:d1")?.sentence).toBe("Rests on this source");
    expect(has("insight:i1", "topic:pfas analysis")?.sentence).toBe("Measures interest in pfas analysis");
    expect(has("insight:i2", "event:e1")?.sentence).toBe("About ARABLAB LIVE 2026");
    expect(has("insight:i3", "topic:gc-ms")?.sentence).toBe("Mentions gc-ms");
    expect(has("doc:d2", "brand:a")?.sentence).toBe("Published by Agilent");
  });

  it("keeps the full insight text for the side panel and a short label for the scene", () => {
    const i1 = map.nodes.find((n) => n.id === "insight:i1")!;
    expect(i1.text).toContain("1.5x typical engagement");
    expect(i1.label.length).toBeLessThanOrEqual(90);
  });

  it("leaves out nodes nothing touches, but always keeps the companies", () => {
    expect(map.nodes.some((n) => n.id === "topic:lonely topic")).toBe(false);
    expect(map.nodes.some((n) => n.id === "insight:i4")).toBe(false);
    expect(map.counts).toMatchObject({ client: 1, competitor: 2, event: 1, source: 2 });
  });

  it("puts the client at the centre and every link on nodes that exist", () => {
    const client = map.nodes.find((n) => n.kind === "client")!;
    expect([client.x, client.y, client.z]).toEqual([0, 0, 0]);
    const ids = new Set(map.nodes.map((n) => n.id));
    expect(map.links.every((l) => ids.has(l.a) && ids.has(l.b))).toBe(true);
  });
});

describe("layout3d", () => {
  it("is deterministic for the same input", () => {
    const nodes = [
      { id: "c", kind: "client" as const },
      { id: "x", kind: "competitor" as const },
      { id: "t", kind: "topic" as const },
    ];
    const links = [{ a: "c", b: "x" }, { a: "x", b: "t" }];
    expect(layout3d(nodes, links)).toEqual(layout3d(nodes, links));
    const [, x, t] = layout3d(nodes, links);
    expect(Math.hypot(t.x, t.y, t.z)).toBeGreaterThan(Math.hypot(x.x, x.y, x.z));
  });
});
