/**
 * Interest signals (campaign intelligence C3) — pure. What people engage
 * with, topic by topic, measured fairly and gated on sample size.
 *
 * Three rules, each from a live finding (2026-09-21):
 *
 *  1. Raw counts are not comparable. Thermo Fisher's posts get 75–687
 *     reactions, Waters' 35–131, because the audiences differ in size. So a
 *     post is scored against ITS OWN company's typical post (engagement index:
 *     1.0 = that company's median post), and topics are compared on the index.
 *  2. A competitor's ads measure its budget, not the market's interest. Ads
 *     become "pressure" signals, kept apart from "interest" signals.
 *  3. Few data points are not a trend. Below MIN_INTEREST_N the answer is
 *     "insufficient signal", never a score (the constitution's min-N gate).
 *
 * A model may map text to one of the client's topics (topicsFor's caller);
 * it never produces a number. Every signal carries its proof URL.
 */

// Scale constants moved to measurement-scales.ts (Brain plan B0, "coastline"
// rule): declared and versioned in one place instead of scattered across
// files. Re-exported here so every existing importer of these three names
// keeps working unchanged.
import { MIN_INTEREST_N, RECENT_DAYS, BASELINE_DAYS } from "./measurement-scales";
export { MIN_INTEREST_N, RECENT_DAYS, BASELINE_DAYS } from "./measurement-scales";
const DAY = 86_400_000;

export type SignalKind = "interest" | "pressure";

export type InterestSignalInput = {
  workspaceId: string;
  brandId: string | null;
  documentId: string | null;
  topic: string;
  region: string;
  channel: string;
  metric: string;
  signalKind: SignalKind;
  value: number;
  observedAt: Date;
  sourceUrl: string;
  detail?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Topics — the client's own vocabulary
// ---------------------------------------------------------------------------

const TOPIC_STOPWORDS = new Set(["solutions", "services", "products", "software", "systems", "lab equipment", "supplies"]);
/** A single field word, not a subject (live 2026-09-23: "analytical", "instruments" ranked as topics). */
const FIELD_WORDS = new Set(["analytical", "analysis", "regulated", "instrument", "instruments", "laboratory", "lab", "labs", "science", "sciences", "scientific", "research", "technology", "technologies", "chemistry", "innovation"]);

/** Too generic to be a campaign subject: a field word, a stop word, or a generic ending ("analytical systems"). */
export function isGenericTopic(topic: string): boolean {
  const t = topic.toLowerCase().trim();
  return FIELD_WORDS.has(t) || TOPIC_STOPWORDS.has(t) || GENERIC_TOPIC.test(t);
}

/**
 * Profile keywords are often marketing words, not subjects: live 2026-09-21
 * Waters' list gave "scientists", "leading provider" and "supplies", and 13
 * posts were filed under "scientists". A topic must name a subject someone
 * could be interested in, so audience nouns and self-description go.
 */
const GENERIC_TOPIC =
  /\b(provider|leader|leading|partner|customers?|clients?|scientists?|researchers?|people|company|companies|solutions?|services?|products?|offerings?|systems?|supplies|world|global|innovation|excellence|quality)$/;

/**
 * The client's topic list: offers first, then keywords, lower-cased, deduped,
 * without the brand's own name and without words too generic to rank
 * ("services"). Capped so a topic assignment prompt stays small.
 */
export function clientTopics(
  profile: { offers?: string[]; keywords?: string[] } | null | undefined,
  brandName: string,
  max = 12,
): string[] {
  const brand = brandName.toLowerCase().trim();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...(profile?.offers ?? []), ...(profile?.keywords ?? [])]) {
    const topic = raw.toLowerCase().replace(/\s+/g, " ").trim();
    if (topic.length < 3 || topic === brand || TOPIC_STOPWORDS.has(topic) || seen.has(topic)) continue;
    if (GENERIC_TOPIC.test(topic)) continue;
    seen.add(topic);
    out.push(topic);
    if (out.length === max) break;
  }
  return out;
}

/**
 * Topics a text is plainly about, by whole-phrase match (case-insensitive,
 * plurals tolerated). Cheap and deterministic; texts that match nothing go to
 * the model-backed assigner, which must still choose from `topics`.
 */
export function topicsByKeyword(text: string, topics: string[]): string[] {
  const hay = ` ${text.toLowerCase().replace(/[^a-z0-9+\-]+/g, " ")} `;
  return topics.filter((topic) => {
    const needle = topic.toLowerCase().replace(/[^a-z0-9+\-]+/g, " ").trim();
    if (!needle) return false;
    return hay.includes(` ${needle} `) || hay.includes(` ${needle}s `);
  });
}

// ---------------------------------------------------------------------------
// From documents to signals
// ---------------------------------------------------------------------------

export type SocialDoc = {
  id: string;
  brandId: string | null;
  canonicalUrl: string | null;
  sourceUrl: string;
  body: string;
  metrics: { likes?: number; comments?: number; shares?: number; postedAt?: string } | null;
};

/** Reactions + comments + reposts. Null when nothing was measured. */
export function engagementOf(metrics: SocialDoc["metrics"]): number | null {
  if (!metrics) return null;
  const parts = [metrics.likes, metrics.comments, metrics.shares].filter(
    (v): v is number => typeof v === "number",
  );
  return parts.length > 0 ? parts.reduce((a, b) => a + b, 0) : null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * One interest signal per (post, topic): the post's engagement index against
 * its own company's median post. A company with fewer than 3 measured posts
 * has no fair median yet, so its posts produce nothing (rather than an index
 * against a sample of one).
 */
export function socialInterestSignals(
  workspaceId: string,
  docs: SocialDoc[],
  topicsOf: (doc: SocialDoc) => string[],
  channel = "linkedin",
): InterestSignalInput[] {
  const byBrand = new Map<string, number[]>();
  for (const doc of docs) {
    const e = engagementOf(doc.metrics);
    if (e === null) continue;
    const key = doc.brandId ?? "";
    byBrand.set(key, [...(byBrand.get(key) ?? []), e]);
  }
  const out: InterestSignalInput[] = [];
  for (const doc of docs) {
    const e = engagementOf(doc.metrics);
    const sample = byBrand.get(doc.brandId ?? "") ?? [];
    const typical = median(sample);
    if (e === null || !typical || sample.length < 3 || !doc.metrics?.postedAt) continue;
    for (const topic of topicsOf(doc)) {
      out.push({
        workspaceId,
        brandId: doc.brandId,
        documentId: doc.id,
        topic,
        region: "global",
        channel,
        metric: "engagement_index",
        signalKind: "interest",
        value: Math.round((e / typical) * 100) / 100,
        observedAt: new Date(doc.metrics.postedAt),
        sourceUrl: doc.canonicalUrl ?? doc.sourceUrl,
        detail: { engagement: e, companyMedian: typical, posts: sample.length },
      });
    }
  }
  return out;
}

/**
 * Competitor ads as pressure: one signal per (ad, topic), value = days the ad
 * has been running (an ad kept alive for 60 days is one they believe in).
 */
export function adPressureSignals(
  workspaceId: string,
  ads: {
    id: string;
    brandId: string | null;
    canonicalUrl: string | null;
    sourceUrl: string;
    body: string;
    startedAt: Date | null;
    /** Last day it ran, when the library says (LinkedIn); open-ended otherwise. */
    endedAt?: Date | null;
    countries: string[];
  }[],
  topicsOf: (ad: { id: string; body: string }) => string[],
  channel: string,
  now: Date,
): InterestSignalInput[] {
  const out: InterestSignalInput[] = [];
  for (const ad of ads) {
    if (!ad.startedAt) continue;
    const span = (until: Date) => Math.round((until.getTime() - ad.startedAt!.getTime()) / DAY);
    // With a known last day both ends count (shown on one day = 1 day).
    const days = ad.endedAt
      ? Math.max(1, span(ad.endedAt.getTime() < now.getTime() ? ad.endedAt : now) + 1)
      : Math.max(0, span(now));
    for (const topic of topicsOf(ad)) {
      for (const region of ad.countries.length > 0 ? ad.countries : ["global"]) {
        out.push({
          workspaceId,
          brandId: ad.brandId,
          documentId: ad.id,
          topic,
          region,
          channel,
          metric: "ad_days_running",
          signalKind: "pressure",
          value: days,
          observedAt: ad.startedAt,
          sourceUrl: ad.canonicalUrl ?? ad.sourceUrl,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Momentum — the ranking input
// ---------------------------------------------------------------------------

export type TopicMomentum = {
  topic: string;
  region: string;
  signalKind: SignalKind;
  /** Median value over the last RECENT_DAYS. */
  recent: number | null;
  /** Median value over the BASELINE_DAYS before that. */
  baseline: number | null;
  /** recent − baseline, when both exist. */
  change: number | null;
  /** Data points counted (recent + baseline). */
  n: number;
  status: "ok" | "insufficient";
  /** The strongest proofs, for display. */
  proofs: { sourceUrl: string; value: number; observedAt: Date }[];
};

const round2 = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100);

/**
 * Per topic × region × kind: median now vs. before, sample size, status and
 * the top proofs. Pure — the caller passes `now`. Sorted strongest first:
 * interest before pressure, then by recent value.
 */
export function topicMomentum(
  // Rows straight from the table: signalKind arrives as a plain string.
  signals: (Pick<InterestSignalInput, "topic" | "region" | "value" | "observedAt" | "sourceUrl"> & {
    signalKind: string;
  })[],
  now: Date,
): TopicMomentum[] {
  const groups = new Map<string, typeof signals>();
  for (const s of signals) {
    const key = `${s.topic}\u0000${s.region}\u0000${s.signalKind}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const out: TopicMomentum[] = [];
  for (const [key, rows] of groups) {
    const [topic, region, signalKind] = key.split("\u0000") as [string, string, SignalKind];
    const age = (s: (typeof rows)[number]) => (now.getTime() - new Date(s.observedAt).getTime()) / DAY;
    const recentRows = rows.filter((s) => age(s) >= 0 && age(s) <= RECENT_DAYS);
    const baseRows = rows.filter((s) => age(s) > RECENT_DAYS && age(s) <= RECENT_DAYS + BASELINE_DAYS);
    const n = recentRows.length + baseRows.length;
    // Median, not mean: live 2026-09-21 one viral Bruker post (18.29×) lifted
    // the mass-spectrometry mean of 32 posts to 2.17×. A topic's value is what
    // a typical post on it gets; the viral one is still shown as a proof.
    const recent = median(recentRows.map((s) => s.value));
    const baseline = median(baseRows.map((s) => s.value));
    out.push({
      topic,
      region,
      signalKind,
      recent: round2(recent),
      baseline: round2(baseline),
      change: recent !== null && baseline !== null ? round2(recent - baseline) : null,
      n,
      status: n >= MIN_INTEREST_N ? "ok" : "insufficient",
      proofs: [...recentRows, ...baseRows]
        .sort((a, b) => b.value - a.value)
        .slice(0, 3)
        .map((s) => ({ sourceUrl: s.sourceUrl, value: s.value, observedAt: new Date(s.observedAt) })),
    });
  }
  return out.sort(
    (a, b) =>
      (a.signalKind === b.signalKind ? 0 : a.signalKind === "interest" ? -1 : 1) ||
      (a.status === b.status ? 0 : a.status === "ok" ? -1 : 1) ||
      (b.recent ?? -1) - (a.recent ?? -1),
  );
}
