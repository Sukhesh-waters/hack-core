/**
 * The Ads page (C8.3): the client's and its competitors' ads from the public
 * ad libraries, side by side, and what code detects in them. Pure: the page
 * and the Brain sync gather the rows, this builds the view.
 *
 * Every measure here is ACTIVITY, not performance: which ads ran, when, for
 * how long, and where they were shown. No library publishes spend, clicks or
 * conversions, so none is shown or estimated. LinkedIn publishes an
 * impression RANGE and each country's share of impressions; Meta publishes
 * neither outside the EU and political ads, which reads "not published".
 *
 * Detections are min-N gated: below the threshold they are not shown at all.
 */
import { countryCode, countryName } from "./countries";
import { adSearchTerm, advertiserMatches } from "./fetch/actors";
import { isGenericTopic } from "./interest";
import { adCountries, adEndedAt, adStartedAt } from "./interest-extract";
import { GCC_COUNTRIES } from "./events";
import { sampleConfidence, type MarketInsight } from "./market-insights";

const DAY = 86_400_000;
/** "New this week". */
export const NEW_DAYS = 7;
/** An ad whose last day is this recent is still running (the library lags a day or two). */
const ACTIVE_SLACK_DAYS = 2;
/** A competitor push: this many new ads on one subject within PUSH_WINDOW_DAYS. */
export const PUSH_MIN = 3;
export const PUSH_WINDOW_DAYS = 30;
/** Pushes shown per competitor: its strongest subjects only. */
export const PUSHES_PER_BRAND = 2;
/** Region and theme gaps look at this window. */
export const GAP_WINDOW_DAYS = 90;
/** Competitor ads shown in the region before a gap is called. */
export const REGION_MIN = 2;
/** Competitor ads on one subject (and none from the client) before it is ad white space. */
export const THEME_MIN = 3;
/** An ad kept this long is one the advertiser believes in. */
export const LONG_RUN_DAYS = 45;

export type AdDoc = {
  id: string;
  brandId: string | null;
  sourceUrl: string;
  canonicalUrl: string | null;
  fetchedAt: Date;
  body: string;
  raw: unknown;
};

export type AdCountry = { code: string; name: string; share: string | null };

export type AdCard = {
  /** The ad's library URL: one card per ad, whatever the number of snapshots. */
  key: string;
  /** The newest snapshot document: the proof a Brain insight cites. */
  docId: string;
  platform: "linkedin" | "meta";
  brandId: string;
  advertiser: string;
  headline: string | null;
  text: string;
  cta: string | null;
  landingUrl: string | null;
  libraryUrl: string;
  imageUrl: string | null;
  format: string | null;
  startedOn: string | null;
  endedOn: string | null;
  active: boolean;
  daysRunning: number | null;
  /** LinkedIn's published range ("100k-150k"); null = not published. */
  impressions: string | null;
  countries: AdCountry[];
  targeting: string | null;
  topics: string[];
  isNew: boolean;
  inRegion: boolean;
};

export type AdColumn = {
  brandId: string;
  name: string;
  isClient: boolean;
  ads: AdCard[];
  active: number;
  newThisWeek: number;
  regionAds: number;
  topTopics: { topic: string; ads: number }[];
  lastRead: string | null;
};

export type AdDetectionKind = "push" | "region_gap" | "theme_gap" | "long_runner";

export type AdDetection = {
  key: string;
  kind: AdDetectionKind;
  brandId: string;
  title: string;
  detail: string;
  n: number;
  proofs: { label: string; url: string; docId: string }[];
};

export type AdsView = {
  columns: AdColumn[];
  detections: AdDetection[];
  totals: { ads: number; active: number; newThisWeek: number; linkedin: number; meta: number };
  region: { label: string; codes: readonly string[] };
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** One card from one stored ad document (LinkedIn or Meta raw shape). */
export function adCard(doc: AdDoc, brandId: string, topics: string[], now: Date, region: readonly string[]): AdCard | null {
  const r = (doc.raw ?? {}) as Record<string, unknown>;
  const linkedIn = r.platform === "linkedin" || typeof r.adLibraryUrl === "string";
  const started = adStartedAt(r);
  const ended = adEndedAt(r);
  const codes = adCountries(r);
  // Each country's share of the ad's impressions, by ISO code ("Turkey" and Intl's "Türkiye" are one).
  const shares = new Map(
    (Array.isArray(r.impressionsPerCountry) ? (r.impressionsPerCountry as { country?: unknown; impressions?: unknown }[]) : []).map(
      (c) => [countryCode(String(c.country ?? "")), str(c.impressions)] as const,
    ),
  );
  const countries = codes.map((code) => ({ code, name: countryName(code), share: shares.get(code) ?? null }));
  if (linkedIn) {
    const libraryUrl = str(r.adLibraryUrl) ?? doc.canonicalUrl;
    if (!libraryUrl) return null;
    const active = ended ? now.getTime() - ended.getTime() <= ACTIVE_SLACK_DAYS * DAY : true;
    // Counted to the last day the library reports (both ends included).
    const until = ended ?? now;
    return {
      key: libraryUrl,
      docId: doc.id,
      platform: "linkedin",
      brandId,
      advertiser: str(r.advertiserName) ?? "",
      headline: str(r.headline),
      text: str(r.body) ?? doc.body,
      cta: Array.isArray(r.ctas) ? (str(r.ctas[0]) ?? null) : null,
      landingUrl: cleanLanding(str(r.clickUrl)),
      libraryUrl,
      imageUrl: str(r.imageUrl),
      format: str(r.format),
      startedOn: day(started),
      endedOn: day(ended),
      active,
      daysRunning: started ? Math.max(1, Math.round((until.getTime() - started.getTime()) / DAY) + 1) : null,
      impressions: str(r.impressions),
      countries,
      targeting: str((r.targeting as Record<string, unknown> | undefined)?.location),
      topics,
      isNew: Boolean(started && now.getTime() - started.getTime() <= NEW_DAYS * DAY),
      inRegion: codes.some((c) => region.includes(c)),
    };
  }
  // Meta (curious_coder actor): snapshot fields, unix dates, country codes.
  const archiveId = str(r.ad_archive_id);
  const snapshot = (r.snapshot ?? {}) as Record<string, unknown>;
  const endUnix = typeof r.end_date === "number" && r.end_date > 0 ? new Date(r.end_date * 1000) : null;
  const active = typeof r.is_active === "boolean" ? r.is_active : !endUnix || now.getTime() - endUnix.getTime() <= ACTIVE_SLACK_DAYS * DAY;
  const until = endUnix && !active ? endUnix : now;
  return {
    key: archiveId ? `https://www.facebook.com/ads/library/?id=${archiveId}` : (doc.canonicalUrl ?? doc.sourceUrl),
    docId: doc.id,
    platform: "meta",
    brandId,
    advertiser: str(r.page_name) ?? "",
    headline: str(snapshot.title),
    text: doc.body,
    cta: str(snapshot.cta_text),
    landingUrl: cleanLanding(str(snapshot.link_url)),
    libraryUrl: archiveId ? `https://www.facebook.com/ads/library/?id=${archiveId}` : doc.sourceUrl,
    imageUrl: null,
    format: str(snapshot.display_format),
    startedOn: day(started),
    endedOn: day(endUnix),
    active,
    daysRunning: started ? Math.max(1, Math.round((until.getTime() - started.getTime()) / DAY)) : null,
    impressions: null,
    countries,
    targeting: null,
    topics,
    isNew: Boolean(started && now.getTime() - started.getTime() <= NEW_DAYS * DAY),
    inRegion: codes.some((c) => region.includes(c)),
  };
}

/** The ad is by the advertiser its source searched for (the libraries' searches are loose). */
function isAdvertisersOwn(d: AdDoc): boolean {
  const searched = adSearchTerm(d.sourceUrl);
  const r = (d.raw ?? {}) as { page_name?: unknown; advertiserName?: unknown };
  const name = r.advertiserName ?? r.page_name;
  return !searched || (typeof name === "string" && advertiserMatches(name, searched));
}

/** A landing page without LinkedIn's tracking suffix. */
function cleanLanding(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    for (const p of [...u.searchParams.keys()]) if (/^(trk|utm_|li_fat_id|gclid|fbclid)/i.test(p)) u.searchParams.delete(p);
    return u.toString();
  } catch {
    return null;
  }
}

export function buildAdsView(input: {
  client: { id: string; name: string };
  competitors: { id: string; name: string }[];
  docs: AdDoc[];
  /** Subjects per ad, by the ad's library URL (from the pressure signals). */
  topicsByAd: Map<string, string[]>;
  now: Date;
  region?: { label: string; codes: readonly string[] };
}): AdsView {
  const region = input.region ?? { label: "the Gulf", codes: GCC_COUNTRIES };
  const brands = [{ ...input.client, isClient: true }, ...input.competitors.map((c) => ({ ...c, isClient: false }))];
  const known = new Set(brands.map((b) => b.id));

  // Newest snapshot per ad, and only the searched advertiser's own ads (Meta
  // ads stored before the advertiser filter, 2026-09-21, included cruise lines).
  const newest = new Map<string, AdDoc>();
  for (const d of input.docs) {
    if (!d.brandId || !known.has(d.brandId) || !isAdvertisersOwn(d)) continue;
    const key = d.canonicalUrl ?? `${d.sourceUrl}#${d.id}`;
    const seen = newest.get(key);
    if (!seen || new Date(d.fetchedAt).getTime() > new Date(seen.fetchedAt).getTime()) newest.set(key, d);
  }
  const cards: AdCard[] = [];
  const lastRead = new Map<string, number>();
  for (const [key, d] of newest) {
    // A field word ("analytical") is not a subject anyone campaigns on.
    const topics = (input.topicsByAd.get(key) ?? []).filter((t) => !isGenericTopic(t));
    const card = adCard(d, d.brandId!, topics, input.now, region.codes);
    if (card) cards.push(card);
    lastRead.set(d.brandId!, Math.max(lastRead.get(d.brandId!) ?? 0, new Date(d.fetchedAt).getTime()));
  }
  const newestFirst = (a: AdCard, b: AdCard) => (b.startedOn ?? "").localeCompare(a.startedOn ?? "") || a.key.localeCompare(b.key);

  const columns: AdColumn[] = brands.map((b) => {
    const ads = cards.filter((c) => c.brandId === b.id).sort(newestFirst);
    const topicCounts = new Map<string, number>();
    for (const a of ads) for (const t of a.topics) topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
    return {
      brandId: b.id,
      name: b.name,
      isClient: b.isClient,
      ads,
      active: ads.filter((a) => a.active).length,
      newThisWeek: ads.filter((a) => a.isNew).length,
      regionAds: ads.filter((a) => a.inRegion).length,
      topTopics: [...topicCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([topic, n]) => ({ topic, ads: n })),
      lastRead: lastRead.has(b.id) ? new Date(lastRead.get(b.id)!).toISOString() : null,
    };
  });

  return {
    columns,
    detections: detect(input.client, brands, cards, input.now, region),
    totals: {
      ads: cards.length,
      active: cards.filter((c) => c.active).length,
      newThisWeek: cards.filter((c) => c.isNew).length,
      linkedin: cards.filter((c) => c.platform === "linkedin").length,
      meta: cards.filter((c) => c.platform === "meta").length,
    },
    region,
  };
}

const proof = (a: AdCard) => ({
  label: `${a.advertiser || "ad"}${a.startedOn ? `, from ${a.startedOn}` : ""}${a.headline ? `: ${clip(a.headline, 70)}` : ""}`,
  url: a.libraryUrl,
  docId: a.docId,
});
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const since = (a: AdCard, now: Date, days: number) =>
  a.startedOn !== null && now.getTime() - new Date(`${a.startedOn}T00:00:00Z`).getTime() <= days * DAY;
/** Ran at any time inside the window (started in it, or still running into it). */
const within = (a: AdCard, now: Date, days: number) =>
  since(a, now, days) || (a.endedOn !== null && now.getTime() - new Date(`${a.endedOn}T00:00:00Z`).getTime() <= days * DAY) || a.active;

function detect(
  client: { id: string; name: string },
  brands: { id: string; name: string; isClient: boolean }[],
  cards: AdCard[],
  now: Date,
  region: { label: string; codes: readonly string[] },
): AdDetection[] {
  const out: AdDetection[] = [];
  const name = new Map(brands.map((b) => [b.id, b.name]));
  const clientAds = cards.filter((c) => c.brandId === client.id);
  const competitorAds = cards.filter((c) => c.brandId !== client.id);

  // 1. Competitor push: several new ads on one subject within a month.
  for (const b of brands.filter((x) => !x.isClient)) {
    const recent = competitorAds.filter((a) => a.brandId === b.id && since(a, now, PUSH_WINDOW_DAYS));
    const byTopic = new Map<string, AdCard[]>();
    for (const a of recent) for (const t of a.topics) byTopic.set(t, [...(byTopic.get(t) ?? []), a]);
    const strongest = [...byTopic.entries()]
      .filter(([, ads]) => ads.length >= PUSH_MIN)
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .slice(0, PUSHES_PER_BRAND);
    for (const [topic, ads] of strongest) {
      out.push({
        key: `push:${b.id}:${topic}`,
        kind: "push",
        brandId: b.id,
        title: `${b.name} is pushing ${topic}`,
        detail: `${b.name} started ${ads.length} ads on ${topic} in the last ${PUSH_WINDOW_DAYS} days.`,
        n: ads.length,
        proofs: ads.slice(0, 5).map(proof),
      });
    }
  }

  // 2. Region gap: competitors' ads were shown in the region; none of the client's were.
  const clientInRegion = clientAds.filter((a) => a.inRegion && within(a, now, GAP_WINDOW_DAYS));
  if (clientInRegion.length === 0) {
    for (const b of brands.filter((x) => !x.isClient)) {
      const ads = competitorAds.filter((a) => a.brandId === b.id && a.inRegion && within(a, now, GAP_WINDOW_DAYS));
      if (ads.length < REGION_MIN) continue;
      const where = [...new Set(ads.flatMap((a) => a.countries.filter((c) => region.codes.includes(c.code)).map((c) => c.name)))];
      out.push({
        key: `region_gap:${b.id}:${region.codes.join("-")}`,
        kind: "region_gap",
        brandId: b.id,
        title: `${b.name} advertises in ${region.label}; ${client.name} does not`,
        detail: `${ads.length} ${b.name} ads were shown in ${where.join(", ")} in the last ${GAP_WINDOW_DAYS} days. No ${client.name} ad in the library was shown in ${region.label} in that time.`,
        n: ads.length,
        proofs: ads.slice(0, 5).map(proof),
      });
    }
  }

  // 3. Ad white space: competitors advertise a subject the client never does.
  const clientTopics = new Set(clientAds.filter((a) => within(a, now, GAP_WINDOW_DAYS)).flatMap((a) => a.topics));
  const theirs = new Map<string, AdCard[]>();
  for (const a of competitorAds.filter((x) => within(x, now, GAP_WINDOW_DAYS))) {
    for (const t of a.topics) if (!clientTopics.has(t)) theirs.set(t, [...(theirs.get(t) ?? []), a]);
  }
  for (const [topic, ads] of theirs) {
    if (ads.length < THEME_MIN) continue;
    const who = [...new Set(ads.map((a) => name.get(a.brandId) ?? ""))].filter(Boolean);
    out.push({
      key: `theme_gap:${topic}`,
      kind: "theme_gap",
      brandId: client.id,
      title: `Only competitors advertise ${topic}`,
      detail: `${who.join(", ")} ran ${ads.length} ads on ${topic} in the last ${GAP_WINDOW_DAYS} days; ${client.name} ran none.`,
      n: ads.length,
      proofs: ads.slice(0, 5).map(proof),
    });
  }

  // 4. Long runners: ads kept alive for weeks (the advertiser believes in them).
  for (const a of cards.filter((c) => c.active && (c.daysRunning ?? 0) >= LONG_RUN_DAYS).sort((x, y) => (y.daysRunning ?? 0) - (x.daysRunning ?? 0)).slice(0, 4)) {
    const who = name.get(a.brandId) ?? a.advertiser;
    out.push({
      key: `long_runner:${a.key}`,
      kind: "long_runner",
      brandId: a.brandId,
      title: `${who} has kept one ad running for ${a.daysRunning} days`,
      detail: `"${clip(a.headline ?? a.text, 110)}" has run since ${a.startedOn}. An ad kept that long is one the advertiser believes in.`,
      n: 1,
      proofs: [proof(a)],
    });
  }

  const order: Record<AdDetectionKind, number> = { region_gap: 0, push: 1, theme_gap: 2, long_runner: 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || b.n - a.n || a.key.localeCompare(b.key));
}

/**
 * Detections as measured Brain insights (C8.3 T6.11), so the planner,
 * Opportunities and ideation retrieve them. Keys sit under
 * `ads:<clientId>:` — an unchanged detection leaves its insight untouched,
 * one that no longer holds is retired (planInsightWrites).
 */
export function adInsights(client: { id: string; name: string }, view: AdsView, now: Date): MarketInsight[] {
  const asOf = now.toISOString().slice(0, 10);
  return view.detections
    .filter((d) => d.kind !== "long_runner" || d.brandId !== client.id)
    .map((d) => ({
      key: `ads:${client.id}:${d.key}`,
      content: `Ad activity for ${client.name} (public ad libraries, data to ${asOf}; activity, not performance): ${d.title}. ${d.detail}`,
      sourceSignalIds: [...new Set(d.proofs.map((p) => p.docId))],
      confidence: sampleConfidence(d.n),
    }));
}
