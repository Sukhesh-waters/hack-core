/**
 * The live flow as a graph (real-time 3D view). Pure: counts in, nodes,
 * edges and layout out, plus what changed between two snapshots so the view
 * can fire a burst along exactly the paths that just carried data.
 *
 * Every node and number is a real workspace count (flow-snapshot queries);
 * nothing here is decorative data.
 */

export type FlowCounts = {
  docs: { web: number; linkedin: number; ads: number; events: number };
  docs24h: { web: number; linkedin: number; ads: number; events: number };
  debates: number;
  debates24h: number;
  interestSignals: number;
  interestSignals24h: number;
  events: number;
  eventsUpcoming: number;
  events24h: number;
  brain: { claims: number; measured: number; events: number };
  brain24h: number;
  findings: number;
  findingsNew: number;
  plans: number;
  plans24h: number;
  outcomes: number;
  runsActive: number;
};

export type FlowStage = "sources" | "collected" | "analysis" | "brain" | "use" | "results";

export type FlowNode = {
  id: string;
  label: string;
  stage: FlowStage;
  /** The count the node stands for. */
  value: number;
  /** A short line under the label: "25 in the last 24 h". */
  caption: string;
  position: [number, number, number];
};

export type FlowEdge = {
  id: string;
  from: string;
  to: string;
  /** Items that moved along this edge in the last 24 h (particle density). */
  rate: number;
  /** Cumulative count used to detect new arrivals between snapshots. */
  total: number;
  /** A loop back (results feeding the planner): drawn dashed. */
  feedback?: boolean;
};

export const STAGES: { id: FlowStage; label: string }[] = [
  { id: "sources", label: "Sources" },
  { id: "collected", label: "Collected" },
  { id: "analysis", label: "AI analysis" },
  { id: "brain", label: "Brain (vectors)" },
  { id: "use", label: "Use" },
  { id: "results", label: "Results" },
];

const STAGE_X: Record<FlowStage, number> = {
  sources: -10,
  collected: -6,
  analysis: -2,
  brain: 2.5,
  use: 7,
  results: 11,
};

/** Horizontal extent of the layout (for camera fitting). */
export const FLOW_BOUNDS = { minX: -11.5, maxX: 12.5, minY: -5, maxY: 5.5 };

/** Where each stage's column sits, for the column titles. */
export function stageX(stage: FlowStage): number {
  return STAGE_X[stage];
}

/** Spread n nodes of one stage on a vertical arc, slightly curved in depth. */
function column(stage: FlowStage, i: number, n: number): [number, number, number] {
  const spacing = 3.1;
  const y = (n - 1) * spacing * 0.5 - i * spacing;
  const z = -Math.abs(y) * 0.35;
  return [STAGE_X[stage], y, z];
}

const recent = (n: number) => (n > 0 ? `${n} in the last 24 h` : "nothing new in 24 h");

export function buildFlowGraph(c: FlowCounts): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const docsTotal = c.docs.web + c.docs.linkedin + c.docs.ads + c.docs.events;
  const docs24h = c.docs24h.web + c.docs24h.linkedin + c.docs24h.ads + c.docs24h.events;
  const brainTotal = c.brain.claims + c.brain.measured + c.brain.events;

  const spec: Omit<FlowNode, "position">[] = [
    { id: "src:web", label: "Web pages", stage: "sources", value: c.docs.web, caption: recent(c.docs24h.web) },
    { id: "src:linkedin", label: "LinkedIn", stage: "sources", value: c.docs.linkedin, caption: recent(c.docs24h.linkedin) },
    { id: "src:ads", label: "Ad libraries", stage: "sources", value: c.docs.ads, caption: recent(c.docs24h.ads) },
    { id: "src:events", label: "Event pages", stage: "sources", value: c.docs.events, caption: recent(c.docs24h.events) },
    {
      id: "docs",
      label: "Collected",
      stage: "collected",
      value: docsTotal,
      caption: c.runsActive > 0 ? `${c.runsActive} collection${c.runsActive === 1 ? "" : "s"} running now` : recent(docs24h),
    },
    { id: "an:debate", label: "AI debate", stage: "analysis", value: c.debates, caption: recent(c.debates24h) },
    { id: "an:interest", label: "Interest meter", stage: "analysis", value: c.interestSignals, caption: recent(c.interestSignals24h) },
    { id: "an:events", label: "Event reader", stage: "analysis", value: c.events, caption: `${c.eventsUpcoming} upcoming` },
    {
      id: "brain",
      label: "Brain",
      stage: "brain",
      value: brainTotal,
      caption: `${c.brain.claims} claims · ${c.brain.measured} measured · ${c.brain.events} events`,
    },
    { id: "use:opportunities", label: "Opportunities", stage: "use", value: c.eventsUpcoming, caption: "ranked on every visit" },
    { id: "use:planner", label: "Planner", stage: "use", value: c.plans, caption: recent(c.plans24h) },
    { id: "use:findings", label: "Findings", stage: "use", value: c.findings, caption: `${c.findingsNew} awaiting review` },
    { id: "out:results", label: "Recorded results", stage: "results", value: c.outcomes, caption: "teach the planner" },
  ];

  const byStage = new Map<FlowStage, Omit<FlowNode, "position">[]>();
  for (const n of spec) byStage.set(n.stage, [...(byStage.get(n.stage) ?? []), n]);
  const nodes: FlowNode[] = spec.map((n) => {
    const peers = byStage.get(n.stage)!;
    return { ...n, position: column(n.stage, peers.indexOf(n), peers.length) };
  });

  const e = (from: string, to: string, rate: number, total: number, feedback = false): FlowEdge => ({
    id: `${from}->${to}`,
    from,
    to,
    rate,
    total,
    ...(feedback ? { feedback } : {}),
  });

  const edges: FlowEdge[] = [
    e("src:web", "docs", c.docs24h.web, c.docs.web),
    e("src:linkedin", "docs", c.docs24h.linkedin, c.docs.linkedin),
    e("src:ads", "docs", c.docs24h.ads, c.docs.ads),
    e("src:events", "docs", c.docs24h.events, c.docs.events),
    e("docs", "an:debate", c.debates24h, c.debates),
    e("docs", "an:interest", c.interestSignals24h, c.interestSignals),
    e("docs", "an:events", c.events24h, c.events),
    e("an:debate", "brain", c.debates24h, c.brain.claims),
    e("an:interest", "brain", c.brain24h, c.brain.measured),
    e("an:events", "brain", c.events24h, c.brain.events),
    e("brain", "use:planner", c.plans24h, c.plans),
    e("brain", "use:findings", c.debates24h, c.findings),
    e("brain", "use:opportunities", c.brain24h, brainTotal),
    e("use:planner", "out:results", 0, c.outcomes),
    e("out:results", "use:planner", 0, c.outcomes, true),
  ];
  return { nodes, edges };
}

/** Edges whose cumulative count grew since the last snapshot: how much, capped for the view. */
export function arrivals(previous: FlowEdge[] | null, next: FlowEdge[], cap = 12): Map<string, number> {
  const out = new Map<string, number>();
  if (!previous) return out;
  const before = new Map(previous.map((e) => [e.id, e.total]));
  for (const edge of next) {
    const grew = edge.total - (before.get(edge.id) ?? edge.total);
    if (grew > 0) out.set(edge.id, Math.min(cap, grew));
  }
  return out;
}

/** Ambient particles on an edge: none when idle, then logarithmic in the 24 h rate. */
export function ambientParticles(rate: number): number {
  if (rate <= 0) return 0;
  return Math.min(8, 1 + Math.floor(Math.log2(1 + rate)));
}

/** Node radius: readable at 0, logarithmic after. */
export function nodeRadius(value: number): number {
  return Math.round((0.38 + 0.2 * Math.log10(1 + value)) * 100) / 100;
}
