/**
 * Interest extraction for one client (C3): its own and its competitors'
 * collected posts and ads -> topic-tagged interest and pressure signals.
 * Idempotent (the table's unique measurement key), so it can run after every
 * collection and on a daily sweep without double counting.
 */
import type { ClientProfile, PlatinaSignalMetrics } from "@/db/platina-schema";
import {
  adPressureSignals,
  clientTopics,
  socialInterestSignals,
  type InterestSignalInput,
  type SocialDoc,
} from "./interest";
import { adSearchTerm, advertiserMatches } from "./fetch/waters";

/** How far back a pass reads collected documents. */
export const INTEREST_LOOKBACK_DAYS = 120;

export type InterestSourceDoc = {
  id: string;
  brandId: string | null;
  sourceKind: string | null;
  sourceUrl: string;
  canonicalUrl: string | null;
  body: string;
  metrics: PlatinaSignalMetrics | null;
  raw: unknown;
};

export type InterestExtractDeps = {
  getClient: (
    workspaceId: string,
    brandId: string,
  ) => Promise<{ id: string; name: string; kind: string; profile: ClientProfile | null } | null>;
  listCompetitorIds: (workspaceId: string, clientId: string) => Promise<string[]>;
  listDocs: (workspaceId: string, brandIds: string[], since: Date) => Promise<InterestSourceDoc[]>;
  assign: (texts: string[], topics: string[]) => Promise<string[][]>;
  insert: (rows: InterestSignalInput[]) => Promise<number>;
  /**
   * Themes already recorded for this client. Offered back to the model as
   * preferred labels so the same subject gets the same name across passes —
   * live, 11 one-off themes each stayed below the min-N gate.
   */
  listKnownTopics?: (workspaceId: string, brandIds: string[], since: Date) => Promise<string[]>;
};

/** Largest vocabulary a topic prompt carries. */
export const MAX_VOCABULARY = 30;

/** "linkedin:@waters" -> "linkedin"; "instagram:@x" -> "instagram". */
export function channelOf(sourceUrl: string): string {
  const tagged = /^(linkedin|instagram|tiktok):/i.exec(sourceUrl);
  if (tagged) return tagged[1].toLowerCase();
  if (/facebook\.com\/ads\/library/i.test(sourceUrl)) return "meta_ads";
  if (/linkedin\.com\/ad-library/i.test(sourceUrl)) return "linkedin_ads";
  return "web";
}

/** An ad's start: unix seconds (`start_date`) or "YYYY-MM-DD hh:mm:ss". */
export function adStartedAt(raw: unknown): Date | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.start_date === "number" && r.start_date > 0) return new Date(r.start_date * 1000);
  const formatted = typeof r.start_date_formatted === "string" ? r.start_date_formatted : null;
  if (formatted && !Number.isNaN(Date.parse(formatted.replace(" ", "T") + "Z"))) {
    return new Date(formatted.replace(" ", "T") + "Z");
  }
  return null;
}

export function adCountries(raw: unknown): string[] {
  const r = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(r.targeted_or_reached_countries) ? r.targeted_or_reached_countries : [];
  return list.filter((c): c is string => typeof c === "string" && /^[A-Z]{2}$/.test(c));
}

/** Posts are the brand's own; an ad counts only if its advertiser is the brand. */
export function isBrandsOwnItem(d: InterestSourceDoc): boolean {
  if (d.sourceKind !== "ad_library") return true;
  const searched = adSearchTerm(d.sourceUrl);
  const page = (d.raw as { page_name?: unknown } | null)?.page_name;
  return !searched || (typeof page === "string" && advertiserMatches(page, searched));
}

export async function extractInterestForClient(
  deps: InterestExtractDeps,
  input: { workspaceId: string; clientId: string; now?: Date },
): Promise<
  | { status: "skipped"; reason: string }
  | { status: "done"; topics: string[]; docs: number; signals: number; inserted: number }
> {
  const now = input.now ?? new Date();
  const client = await deps.getClient(input.workspaceId, input.clientId);
  if (!client || client.kind !== "own_brand") return { status: "skipped", reason: "not a client" };
  const topics = clientTopics(client.profile, client.name);
  if (topics.length === 0) {
    return { status: "skipped", reason: "no client profile yet — topics come from it" };
  }

  const brandIds = [client.id, ...(await deps.listCompetitorIds(input.workspaceId, client.id))];
  const since = new Date(now.getTime() - INTEREST_LOOKBACK_DAYS * 86_400_000);
  // Ads stored before the advertiser filter existed (2026-09-21: charter boats
  // for "Waters") must not count as the brand's activity — nor cost a model call.
  const docs = (await deps.listDocs(input.workspaceId, brandIds, since)).filter(isBrandsOwnItem);
  if (docs.length === 0) return { status: "skipped", reason: "no posts or ads collected yet" };

  const known = deps.listKnownTopics ? await deps.listKnownTopics(input.workspaceId, brandIds, since) : [];
  const vocabulary = [...new Set([...topics, ...known])].slice(0, MAX_VOCABULARY);
  const assigned = await deps.assign(docs.map((d) => d.body), vocabulary);
  const topicsById = new Map(docs.map((d, i) => [d.id, assigned[i] ?? []]));

  const rows: InterestSignalInput[] = [];
  const social = docs.filter((d) => d.sourceKind === "social_posts" && d.metrics);
  const byChannel = new Map<string, SocialDoc[]>();
  for (const d of social) {
    const channel = channelOf(d.sourceUrl);
    byChannel.set(channel, [...(byChannel.get(channel) ?? []), d]);
  }
  for (const [channel, group] of byChannel) {
    rows.push(
      ...socialInterestSignals(input.workspaceId, group, (doc) => topicsById.get(doc.id) ?? [], channel),
    );
  }

  const ads = docs.filter((d) => d.sourceKind === "ad_library");
  rows.push(
    ...adPressureSignals(
      input.workspaceId,
      ads.map((d) => ({
        id: d.id,
        brandId: d.brandId,
        canonicalUrl: d.canonicalUrl,
        sourceUrl: d.sourceUrl,
        body: d.body,
        startedAt: adStartedAt(d.raw),
        countries: adCountries(d.raw),
      })),
      (ad) => topicsById.get(ad.id) ?? [],
      "meta_ads",
      now,
    ),
  );

  const inserted = await deps.insert(rows);
  return { status: "done", topics, docs: docs.length, signals: rows.length, inserted };
}
