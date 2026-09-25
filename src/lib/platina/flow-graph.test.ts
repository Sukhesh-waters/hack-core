import { describe, expect, it } from "vitest";
import { ambientParticles, arrivals, buildFlowGraph, nodeRadius, type FlowCounts } from "./flow-graph";

const counts = (over: Partial<FlowCounts> = {}): FlowCounts => ({
  docs: { web: 37, linkedin: 151, ads: 10, events: 0 },
  docs24h: { web: 0, linkedin: 102, ads: 0, events: 0 },
  debates: 120,
  debates24h: 30,
  interestSignals: 221,
  interestSignals24h: 122,
  events: 25,
  eventsUpcoming: 8,
  events24h: 25,
  brain: { claims: 40, measured: 11, events: 8 },
  brain24h: 19,
  findings: 119,
  findingsNew: 47,
  plans: 2,
  plans24h: 1,
  outcomes: 0,
  runsActive: 0,
  ...over,
});

describe("buildFlowGraph", () => {
  it("lays every node of a stage in its own column, left to right through the pipeline", () => {
    const { nodes } = buildFlowGraph(counts());
    const x = (id: string) => nodes.find((n) => n.id === id)!.position[0];
    expect(x("src:linkedin")).toBeLessThan(x("docs"));
    expect(x("docs")).toBeLessThan(x("an:interest"));
    expect(x("an:interest")).toBeLessThan(x("brain"));
    expect(x("brain")).toBeLessThan(x("use:planner"));
    expect(x("use:planner")).toBeLessThan(x("out:results"));
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
  });

  it("uses real counts: collected = all sources, brain = claims + measured + events", () => {
    const { nodes } = buildFlowGraph(counts());
    expect(nodes.find((n) => n.id === "docs")!.value).toBe(198);
    expect(nodes.find((n) => n.id === "brain")!).toMatchObject({ value: 59, caption: "40 claims · 11 measured · 8 events" });
    expect(nodes.find((n) => n.id === "src:linkedin")!.caption).toBe("102 in the last 24 h");
    expect(nodes.find((n) => n.id === "src:events")!.caption).toBe("nothing new in 24 h");
  });

  it("says when a collection is running", () => {
    const { nodes } = buildFlowGraph(counts({ runsActive: 2 }));
    expect(nodes.find((n) => n.id === "docs")!.caption).toBe("2 collections running now");
  });

  it("connects only existing nodes, and marks the results loop as feedback", () => {
    const { nodes, edges } = buildFlowGraph(counts());
    const ids = new Set(nodes.map((n) => n.id));
    for (const e of edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
    expect(edges.filter((e) => e.feedback).map((e) => e.id)).toEqual(["out:results->use:planner"]);
  });
});

describe("arrivals", () => {
  it("fires only on edges whose count grew, capped", () => {
    const before = buildFlowGraph(counts()).edges;
    const after = buildFlowGraph(
      counts({ docs: { web: 37, linkedin: 176, ads: 10, events: 7 }, brain: { claims: 40, measured: 11, events: 9 } }),
    ).edges;
    const fired = arrivals(before, after);
    expect(fired.get("src:linkedin->docs")).toBe(12);
    expect(fired.get("src:events->docs")).toBe(7);
    expect(fired.get("an:events->brain")).toBe(1);
    expect(fired.has("src:web->docs")).toBe(false);
  });

  it("fires nothing on the first snapshot", () => {
    expect(arrivals(null, buildFlowGraph(counts()).edges).size).toBe(0);
  });
});

describe("visual scales", () => {
  it("ambient particles: none idle, logarithmic, capped", () => {
    expect(ambientParticles(0)).toBe(0);
    expect(ambientParticles(1)).toBe(2);
    expect(ambientParticles(100)).toBe(7);
    expect(ambientParticles(1e6)).toBe(8);
  });

  it("node radius grows slowly with the count", () => {
    expect(nodeRadius(0)).toBe(0.38);
    expect(nodeRadius(9)).toBe(0.58);
    expect(nodeRadius(999)).toBe(0.98);
  });
});

describe("C6 learning loop in the live flow", () => {
  const learning = {
    ownSite: 87,
    ownSite24h: 87,
    lessons: 2,
    lessons24h: 1,
    creatives: 4,
    metrics: 9,
    metrics24h: 3,
    reviewsConfirmed: 2,
    reviewsConfirmed24h: 1,
    backtracks: 3,
    backtracks24h: 2,
  };

  it("adds the own site, first-party knowledge, creatives and learning, on real counts", () => {
    const { nodes, edges } = buildFlowGraph(counts({ learning }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get("src:own")?.value).toBe(87);
    expect(byId.get("firstparty")?.value).toBe(89);
    expect(byId.get("out:learning")?.caption).toContain("3 traced back");
    const loop = edges.filter((e) => e.from === "out:learning");
    expect(loop.map((e) => e.to).sort()).toEqual(["brain", "firstparty", "use:opportunities"]);
    expect(loop.every((e) => e.feedback)).toBe(true);
  });

  it("a confirmed review fires a burst along the loop", () => {
    const before = buildFlowGraph(counts({ learning })).edges;
    const after = buildFlowGraph(counts({ learning: { ...learning, reviewsConfirmed: 3, lessons: 3, backtracks: 4 } })).edges;
    const fired = arrivals(before, after);
    expect(fired.get("out:learning->firstparty")).toBe(1);
    expect(fired.get("out:learning->brain")).toBe(1);
    expect(fired.get("out:creatives->out:learning")).toBe(1);
  });

  it("older snapshots without learning counts still build", () => {
    const { nodes } = buildFlowGraph(counts());
    expect(nodes.some((n) => n.id === "out:learning")).toBe(false);
  });
});
