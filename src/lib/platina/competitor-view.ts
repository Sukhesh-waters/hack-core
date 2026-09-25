/**
 * The competitor portal and pattern layer (C8.2). Pure: what was collected
 * about each competitor, what they post about and how it lands, where they
 * will be, what the analysis found — and across all of them, the patterns:
 * subjects rising in the market, and white space (what competitors talk
 * about that the client does not, and the reverse). Public data only (Plane
 * B); every number is a count or an engagement index already measured.
 */
import { BASELINE_DAYS, isGenericTopic, RECENT_DAYS, topicMomentum } from "./interest";

export type CvBrand = { id: string; name: string; kind: string; homepageUrl: string | null };
export type CvSpec = { id: string; name: string; brandId: string | null; kind: string; lastSuccessAt: Date | null; enabled: boolean };
export type CvDocCount = { brandId: string | null; sourceKind: string | null; n: number; newest: Date | null };
export type CvFinding = { brandId: string | null; title: string; summary: string; useCase: string; createdAt: Date; sourceUrl: string };
export type CvSignal = {
  brandId: string | null;
  topic: string;
  region: string;
  signalKind: string;
  value: number;
  observedAt: Date;
  sourceUrl: string;
};
export type CvEvent = { id: string; name: string; startsOn: string | null; country: string | null };
export type CvParticipant = { eventId: string; brandId: string; evidence: string; sourceUrl: string };

export type CompetitorCard = {
  id: string;
  name: string;
  homepageUrl: string | null;
  collected: { posts: number; pages: number; ads: number; events: number };
  lastCollectedAt: Date | null;
  sources: { name: string; kind: string; lastSuccessAt: Date | null }[];
  topics: { topic: string; posts: number; median: number }[];
  bestPost: { topic: string; value: number; url: string } | null;
  going: { name: string; startsOn: string | null; proof: string }[];
  findings: { title: string; summary: string; at: Date; url: string }[];
};

export type PatternLine = { topic: string; leaders: string[]; value: number | null; change: number | null; n: number; proof: string | null };
export type WhiteSpace = { topic: string; them: { name: string; posts: number }[]; themPosts: number; clientPosts: number };

export type CompetitorView = {
  cards: CompetitorCard[];
  rising: PatternLine[];
  /** Competitors post on it, the client does not (at least MIN_WHITE_SPACE of their posts). */
  theyTalk: WhiteSpace[];
  /** The client posts on it, no competitor does. */
  onlyClient: WhiteSpace[];
};

export const MIN_WHITE_SPACE = 3;

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r2 = (x: number) => Math.round(x * 100) / 100;

const bucket = (kind: string | null): keyof CompetitorCard["collected"] =>
  kind === "social_posts" || kind === "social_profile"
    ? "posts"
    : kind === "ad_library"
      ? "ads"
      : kind === "conference"
        ? "events"
        : "pages";

export function buildCompetitorView(input: {
  client: CvBrand;
  competitors: CvBrand[];
  specs: CvSpec[];
  docCounts: CvDocCount[];
  findings: CvFinding[];
  signals: CvSignal[];
  events: CvEvent[];
  participants: CvParticipant[];
  now: Date;
}): CompetitorView {
  const since = input.now.getTime() - (RECENT_DAYS + BASELINE_DAYS) * 86_400_000;
  // Field words ("analytical", "instruments") are not subjects: left out of every list.
  const interest = input.signals.filter(
    (s) => s.signalKind === "interest" && s.observedAt.getTime() >= since && !isGenericTopic(s.topic),
  );
  const today = input.now.toISOString().slice(0, 10);
  const eventById = new Map(input.events.map((e) => [e.id, e]));

  const cards: CompetitorCard[] = input.competitors.map((b) => {
    const collected = { posts: 0, pages: 0, ads: 0, events: 0 };
    let lastCollectedAt: Date | null = null;
    for (const d of input.docCounts.filter((x) => x.brandId === b.id)) {
      collected[bucket(d.sourceKind)] += Number(d.n);
      if (d.newest && (!lastCollectedAt || d.newest > lastCollectedAt)) lastCollectedAt = d.newest;
    }
    const mine = interest.filter((s) => s.brandId === b.id);
    const byTopic = new Map<string, number[]>();
    for (const s of mine) byTopic.set(s.topic, [...(byTopic.get(s.topic) ?? []), s.value]);
    const topics = [...byTopic.entries()]
      .map(([topic, values]) => ({ topic, posts: values.length, median: r2(median(values)) }))
      .sort((a, b2) => b2.posts - a.posts || b2.median - a.median)
      .slice(0, 5);
    const best = [...mine].sort((a, b2) => b2.value - a.value)[0];
    const going = new Map<string, CompetitorCard["going"][number]>();
    for (const p of input.participants.filter((x) => x.brandId === b.id)) {
      const e = eventById.get(p.eventId);
      if (!e || (e.startsOn && e.startsOn < today) || going.has(e.name)) continue;
      going.set(e.name, { name: e.name, startsOn: e.startsOn, proof: p.sourceUrl });
    }
    return {
      id: b.id,
      name: b.name,
      homepageUrl: b.homepageUrl,
      collected,
      lastCollectedAt,
      sources: input.specs
        .filter((s) => s.brandId === b.id)
        .map((s) => ({ name: s.name, kind: s.kind, lastSuccessAt: s.lastSuccessAt })),
      topics,
      bestPost: best ? { topic: best.topic, value: r2(best.value), url: best.sourceUrl } : null,
      going: [...going.values()].sort((a, b2) => (a.startsOn ?? "9").localeCompare(b2.startsOn ?? "9")),
      findings: input.findings
        .filter((f) => f.brandId === b.id)
        .slice(0, 3)
        .map((f) => ({ title: f.title, summary: f.summary, at: f.createdAt, url: f.sourceUrl })),
    };
  });

  // Pattern layer: momentum across everyone, then who leads each subject.
  const nameOf = new Map([input.client, ...input.competitors].map((b) => [b.id, b.name]));
  const byUrl = new Map(interest.map((s) => [s.sourceUrl, s.brandId]));
  const rising = topicMomentum(interest, input.now)
    .filter((m) => m.status === "ok" && m.signalKind === "interest" && (m.recent ?? 0) >= 1)
    .slice(0, 8)
    .map((m) => ({
      topic: m.topic,
      leaders: [...new Set(m.proofs.map((p) => nameOf.get(byUrl.get(p.sourceUrl) ?? "") ?? "").filter(Boolean))].slice(0, 3),
      value: m.recent,
      change: m.change,
      n: m.n,
      proof: m.proofs[0]?.sourceUrl ?? null,
    }));

  const competitorIds = new Set(input.competitors.map((c) => c.id));
  const topics = new Set(interest.map((s) => s.topic));
  const theyTalk: WhiteSpace[] = [];
  const onlyClient: WhiteSpace[] = [];
  for (const topic of topics) {
    const rows = interest.filter((s) => s.topic === topic);
    const clientPosts = rows.filter((s) => s.brandId === input.client.id).length;
    const perRival = new Map<string, number>();
    for (const s of rows) if (s.brandId && competitorIds.has(s.brandId)) perRival.set(s.brandId, (perRival.get(s.brandId) ?? 0) + 1);
    const themPosts = [...perRival.values()].reduce((a, b) => a + b, 0);
    const them = [...perRival.entries()]
      .map(([id, posts]) => ({ name: nameOf.get(id) ?? id, posts }))
      .sort((a, b) => b.posts - a.posts);
    if (clientPosts === 0 && themPosts >= MIN_WHITE_SPACE) theyTalk.push({ topic, them, themPosts, clientPosts });
    if (themPosts === 0 && clientPosts >= 2) onlyClient.push({ topic, them, themPosts, clientPosts });
  }
  theyTalk.sort((a, b) => b.themPosts - a.themPosts);
  onlyClient.sort((a, b) => b.clientPosts - a.clientPosts);

  return { cards, rising, theyTalk: theyTalk.slice(0, 10), onlyClient: onlyClient.slice(0, 6) };
}
