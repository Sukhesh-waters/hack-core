/**
 * The Brain map (C8.6): every company, subject, event, collected source and
 * AI insight as one connected graph, each link explained in a sentence.
 * Pure: the page gathers rows, this builds nodes and links and places them
 * in 3D with a deterministic force layout (same data -> same picture), so
 * the browser only draws.
 *
 * Public sources and the insights drawn from them are Plane B/C; the client's
 * own pages are not in this map (first-party knowledge stays on its own page).
 */
export type MapNodeKind = "client" | "competitor" | "topic" | "event" | "insight" | "source";

export type MapNode = {
  id: string;
  kind: MapNodeKind;
  label: string;
  /** Full text shown on click (insights, sources). */
  text: string | null;
  url: string | null;
  /** Relative size: connections, capped. */
  weight: number;
  x: number;
  y: number;
  z: number;
};

export type MapLink = { a: string; b: string; sentence: string };

export type BrainMap = { nodes: MapNode[]; links: MapLink[]; counts: Record<MapNodeKind, number> };

export type BrainMapInput = {
  client: { id: string; name: string };
  competitors: { id: string; name: string }[];
  insights: { id: string; content: string; insightKey: string | null; sourceSignalIds: string[] | null; agreementState: string }[];
  documents: { id: string; brandId: string | null; sourceKind: string | null; sourceUrl: string; title: string | null }[];
  topics: { brandId: string | null; topic: string; posts: number }[];
  events: { id: string; eventKey: string; name: string; startsOn: string | null }[];
  participants: { eventId: string; brandId: string; evidence: string }[];
};

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
const KIND_LABEL: Record<string, string> = {
  social_posts: "LinkedIn post",
  competitor_site: "web page",
  press_release: "news release",
  trade_editorial: "trade article",
  conference: "event page",
  ad_library: "ad",
};
const HOW: Record<string, string> = {
  listed_exhibitor: "on the exhibitor list",
  mentioned_on_event_page: "named on the event page",
  announced_in_post: "announced it in a post",
};

export function buildBrainMap(input: BrainMapInput): Omit<BrainMap, "counts"> & { counts: Record<MapNodeKind, number> } {
  const nodes = new Map<string, Omit<MapNode, "x" | "y" | "z" | "weight">>();
  const links: MapLink[] = [];
  const add = (n: Omit<MapNode, "x" | "y" | "z" | "weight">) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
  };
  const link = (a: string, b: string, sentence: string) => {
    if (a !== b && nodes.has(a) && nodes.has(b)) links.push({ a, b, sentence });
  };
  const brandName = new Map([[input.client.id, input.client.name], ...input.competitors.map((c) => [c.id, c.name] as [string, string])]);
  const brandNode = (id: string) => `brand:${id}`;

  add({ id: brandNode(input.client.id), kind: "client", label: input.client.name, text: null, url: null });
  for (const c of input.competitors) {
    add({ id: brandNode(c.id), kind: "competitor", label: c.name, text: null, url: null });
    link(brandNode(c.id), brandNode(input.client.id), `${c.name} competes with ${input.client.name}`);
  }

  // Subjects: posts per company.
  for (const t of input.topics) {
    const id = `topic:${t.topic}`;
    add({ id, kind: "topic", label: t.topic, text: null, url: null });
    if (t.posts > 0 && t.brandId && brandName.has(t.brandId)) {
      link(brandNode(t.brandId), id, `${brandName.get(t.brandId)} posted ${t.posts} time${t.posts === 1 ? "" : "s"} on ${t.topic}`);
    }
  }

  // Events and who is going.
  const eventByKey = new Map(input.events.map((e) => [e.eventKey, e]));
  for (const e of input.events) {
    add({ id: `event:${e.id}`, kind: "event", label: `${e.name}${e.startsOn ? ` (${e.startsOn})` : ""}`, text: null, url: null });
  }
  for (const p of input.participants) {
    const name = brandName.get(p.brandId);
    if (name) link(brandNode(p.brandId), `event:${p.eventId}`, `${name} is going: ${HOW[p.evidence] ?? p.evidence}`);
  }

  // Sources the insights rest on.
  const docById = new Map(input.documents.map((d) => [d.id, d]));
  for (const d of input.documents) {
    const kind = KIND_LABEL[d.sourceKind ?? ""] ?? "source";
    add({ id: `doc:${d.id}`, kind: "source", label: `${kind} · ${host(d.sourceUrl)}`, text: d.title ? clip(d.title, 300) : null, url: d.sourceUrl });
    if (d.brandId && brandName.has(d.brandId)) link(`doc:${d.id}`, brandNode(d.brandId), `Published by ${brandName.get(d.brandId)}`);
  }

  // Insights: rests on its sources; measured ones name their subject or event.
  const topicIds = [...nodes.values()].filter((n) => n.kind === "topic");
  for (const i of input.insights) {
    const id = `insight:${i.id}`;
    add({ id, kind: "insight", label: clip(i.content.replace(/\s+/g, " "), 90), text: clip(i.content, 900), url: null });
    for (const s of (i.sourceSignalIds ?? []).slice(0, 6)) if (docById.has(s)) link(id, `doc:${s}`, "Rests on this source");
    const key = i.insightKey ?? "";
    const measured = /^(interest|pressure):[^:]+:(.+?)(?::[^:]+)?$/.exec(key);
    if (measured) {
      const topic = key.startsWith("pressure:") ? key.split(":")[2] : measured[2];
      link(id, `topic:${topic}`, key.startsWith("pressure:") ? `Measures paid pressure on ${topic}` : `Measures interest in ${topic}`);
    } else if (key.startsWith("event:")) {
      const e = eventByKey.get(key.slice("event:".length));
      if (e) link(id, `event:${e.id}`, `About ${e.name}`);
    } else {
      // A debate insight: connect it to the subjects it names.
      const lower = i.content.toLowerCase();
      for (const t of topicIds) if (t.label.length >= 5 && lower.includes(t.label)) link(id, t.id, `Mentions ${t.label}`);
    }
  }

  // Leave out subjects and sources nothing else touches.
  const degree = new Map<string, number>();
  for (const l of links) {
    degree.set(l.a, (degree.get(l.a) ?? 0) + 1);
    degree.set(l.b, (degree.get(l.b) ?? 0) + 1);
  }
  const kept = [...nodes.values()].filter((n) => n.kind === "client" || n.kind === "competitor" || (degree.get(n.id) ?? 0) > 0);
  const keptIds = new Set(kept.map((n) => n.id));
  const keptLinks = links.filter((l) => keptIds.has(l.a) && keptIds.has(l.b));
  const placed = layout3d(
    kept.map((n) => ({ ...n, weight: Math.min(12, degree.get(n.id) ?? 0) })),
    keptLinks,
  );
  const counts = { client: 0, competitor: 0, topic: 0, event: 0, insight: 0, source: 0 } as Record<MapNodeKind, number>;
  for (const n of placed) counts[n.kind] += 1;
  return { nodes: placed, links: keptLinks, counts };
}

/** Each kind sits on its own shell, companies at the centre, so the picture reads from the middle out. */
const SHELL: Record<MapNodeKind, number> = { client: 0, competitor: 5, topic: 11, event: 13, insight: 18, source: 25 };

/** Deterministic pseudo-random numbers (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Force layout in 3D: links pull together, every node pushes others away,
 * and each node is drawn back to its kind's shell. Deterministic for the
 * same input (seeded start, fixed step count).
 */
export function layout3d<T extends { id: string; kind: MapNodeKind }>(
  nodes: T[],
  links: { a: string; b: string }[],
  steps = 120,
): (T & { x: number; y: number; z: number })[] {
  const rand = rng(nodes.length * 7919 + links.length);
  const pos = nodes.map((n) => {
    const r = SHELL[n.kind] + rand() * 2;
    const u = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    return n.kind === "client" ? [0, 0, 0] : [r * s * Math.cos(phi), r * u * 0.7, r * s * Math.sin(phi)];
  });
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const pairs = links.map((l) => [index.get(l.a)!, index.get(l.b)!] as const).filter(([a, b]) => a !== undefined && b !== undefined);
  const n = nodes.length;
  for (let step = 0; step < steps; step++) {
    const cool = 1 - step / steps;
    const force = pos.map(() => [0, 0, 0]);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i][0] - pos[j][0];
        const dy = pos[i][1] - pos[j][1];
        const dz = pos[i][2] - pos[j][2];
        const d2 = dx * dx + dy * dy + dz * dz + 0.01;
        if (d2 > 64) continue;
        const f = 1.2 / d2;
        force[i][0] += dx * f; force[i][1] += dy * f; force[i][2] += dz * f;
        force[j][0] -= dx * f; force[j][1] -= dy * f; force[j][2] -= dz * f;
      }
    }
    for (const [a, b] of pairs) {
      for (let k = 0; k < 3; k++) {
        const d = pos[b][k] - pos[a][k];
        force[a][k] += d * 0.02;
        force[b][k] -= d * 0.02;
      }
    }
    for (let i = 0; i < n; i++) {
      if (nodes[i].kind === "client") continue;
      const r = Math.hypot(pos[i][0], pos[i][1], pos[i][2]) || 1;
      const pull = (SHELL[nodes[i].kind] - r) * 0.08;
      for (let k = 0; k < 3; k++) pos[i][k] += (force[i][k] + (pos[i][k] / r) * pull) * cool;
    }
  }
  const round = (v: number) => Math.round(v * 100) / 100;
  return nodes.map((node, i) => ({ ...node, x: round(pos[i][0]), y: round(pos[i][1]), z: round(pos[i][2]) }));
}
