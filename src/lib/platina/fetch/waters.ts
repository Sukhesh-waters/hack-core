/**
 * The Waters signal adapter. Maps each operator-chosen source kind to the
 * Apify actor verified in the Slice 0 feasibility matrix
 * (docs/superpowers/plans/platina-apify-actor-matrix.md):
 *
 *   competitor_site / press_release / trade_editorial / conference
 *     → apify/website-content-crawler (cheerio, single page)
 *   ad_library
 *     → curious_coder/facebook-ads-library-scraper (residential proxy;
 *       minimum charge 10 results — batch queries per run)
 *
 * This module talks to the Apify platform API directly; it does not import
 * InstaMedia's connector modules. Every emitted document is public/raw
 * (Plane B): canonical URL + content hash set, never embedded, never citable.
 *
 * Failure discipline: a failed target is collected in `failures` and never
 * becomes a fake signal document; if every target fails, the fetch throws so
 * the run is marked failed rather than degraded-with-nothing.
 */
import type { PlatinaScanTarget } from "@/db/platina-schema";
import {
  adSearchTerm,
  advertiserMatches,
  effectivePages,
  isLinkedInAdLibrary,
  isSocialKind,
  mapSocialItem,
  parseSocialRef,
  planTarget,
} from "./actors";
import { canonicalizeUrl, contentHash } from "./canonical";
import {
  FIRECRAWL_MAX_AGE_MS,
  SIGNAL_PROMPT,
  SIGNAL_SCHEMA,
  collectSiteWithFirecrawl,
  extractJsonEnabled,
  firecrawlPlan,
  firecrawlSitePlan,
  mapFirecrawlPage,
  shouldFallBack,
} from "./firecrawl-web";
import { mapSite, scrapeWithFirecrawl } from "@/lib/scrape/firecrawl";
import { shouldEscalate } from "./render";
import {
  registerAdapter,
  type ApprovedScanSpec,
  type FetchOutcome,
  type RawSignalDoc,
} from "./registry";

const CONTENT_CRAWLER = "apify~website-content-crawler";
const AD_LIBRARY = "curious_coder~facebook-ads-library-scraper";

export function actorForSourceKind(kind: PlatinaScanTarget["kind"]): string {
  switch (kind) {
    case "competitor_site":
    case "press_release":
    case "trade_editorial":
    case "conference":
      return CONTENT_CRAWLER;
    case "ad_library":
      return AD_LIBRARY;
    default:
      throw new Error(`no actor mapped for source kind: ${kind}`);
  }
}

const APIFY_BASE = "https://api.apify.com/v2/acts";

async function runActor(
  actorSlug: string,
  input: Record<string, unknown>,
  memoryMb?: number,
): Promise<Record<string, unknown>[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not set");
  const memory = memoryMb ? `?memory=${memoryMb}` : "";
  const res = await fetch(
    `${APIFY_BASE}/${actorSlug}/run-sync-get-dataset-items${memory}`,
    {
      method: "POST",
      // The token travels in a header, never the URL (URLs end up in logs).
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(240_000),
    },
  );
  if (res.status === 402) {
    // 402 is Apify's "limit reached": the account's memory (too many runs at
    // once) or its monthly usage — never a problem with the target site.
    throw new Error(
      "Apify refused the run (402): the account's memory or usage limit was reached — too many runs at once, or credits are used up",
    );
  }
  if (!res.ok) {
    throw new Error(`Apify run failed (${res.status})`);
  }
  const items = await res.json();
  if (!Array.isArray(items)) {
    throw new Error("Apify returned an unexpected payload");
  }
  return items as Record<string, unknown>[];
}

function mapPageItem(
  item: Record<string, unknown>,
  target: PlatinaScanTarget,
): RawSignalDoc | null {
  const metadata = (item.metadata ?? {}) as Record<string, unknown>;
  const body =
    (typeof item.markdown === "string" && item.markdown) ||
    (typeof item.text === "string" && item.text) ||
    "";
  if (!body.trim()) return null;
  const canonical = canonicalizeUrl(
    typeof item.url === "string" ? item.url : target.value,
  );
  return {
    sourceUrl: target.value,
    canonicalUrl: canonical,
    title: typeof metadata.title === "string" ? metadata.title : undefined,
    body,
    adapter: "apify",
    sourceKind: target.kind,
    contentHash: contentHash(canonical, body),
    raw: item,
  };
}


export { adSearchTerm, advertiserMatches } from "./actors";

/**
 * The ad's words. Meta's snapshot carries the primary text as
 * `body: { text }` (an object, not a string — the old mapper read a string
 * and so stored every ad as "Ad <id> by <page>" with no text at all), plus
 * headline, link description, CTA and carousel cards.
 */
export function adText(snapshot: Record<string, unknown>): string {
  const text = (v: unknown): string =>
    typeof v === "string"
      ? v
      : v && typeof v === "object" && typeof (v as { text?: unknown }).text === "string"
        ? ((v as { text: string }).text)
        : "";
  const cards = Array.isArray(snapshot.cards) ? (snapshot.cards as Record<string, unknown>[]) : [];
  const parts = [
    text(snapshot.title),
    text(snapshot.body),
    text(snapshot.link_description),
    ...cards.flatMap((c) => [text(c.title), text(c.body)]),
    text(snapshot.cta_text) ? `Call to action: ${text(snapshot.cta_text)}` : "",
  ]
    .map((p) => p.replace(/\{\{product\.[a-z_]+\}\}/gi, "").trim())
    .filter(Boolean);
  return [...new Set(parts)].join("\n\n");
}

/**
 * One LinkedIn Ad Library ad (C8.3). Kept only when its advertiser is the one
 * searched for (the library's search is fuzzy). A re-read that finds a new
 * end date or impression range is a new snapshot document; the ad itself is
 * identified by its library URL.
 */
export function mapLinkedInAdItem(
  item: Record<string, unknown>,
  target: PlatinaScanTarget,
): RawSignalDoc | null {
  if (typeof item.error === "string" || typeof item.errorDescription === "string") return null;
  const advertiser = typeof item.advertiserName === "string" ? item.advertiserName : "";
  const searched = adSearchTerm(target.value);
  if (searched && !advertiserMatches(advertiser, searched)) return null;
  const libraryUrl = typeof item.adLibraryUrl === "string" ? item.adLibraryUrl : "";
  if (!libraryUrl) return null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
  const body = [str(item.headline), str(item.body)].filter(Boolean).join("\n\n");
  if (!body) return null;
  const availability = (item.availability ?? {}) as Record<string, unknown>;
  const canonical = canonicalizeUrl(libraryUrl);
  const raw = {
    platform: "linkedin",
    adId: item.adId,
    adLibraryUrl: libraryUrl,
    advertiserName: advertiser,
    headline: item.headline,
    body: item.body,
    ctas: item.ctas,
    clickUrl: item.clickUrl,
    format: item.format,
    imageUrl: item.imageUrl,
    availability: { start: availability.start, end: availability.end },
    impressions: item.impressions,
    impressionsPerCountry: item.impressionsPerCountry,
    targeting: item.targeting,
    paidBy: item.paidBy,
  };
  return {
    sourceUrl: target.value,
    canonicalUrl: canonical,
    title: `LinkedIn ad · ${advertiser}`,
    body,
    adapter: "apify",
    sourceKind: target.kind,
    contentHash: contentHash(canonical, `${body}|${str(availability.end)}|${str(item.impressions)}`),
    raw,
  };
}

function mapAdItem(
  item: Record<string, unknown>,
  target: PlatinaScanTarget,
): RawSignalDoc | null {
  if (isLinkedInAdLibrary(target.value)) return mapLinkedInAdItem(item, target);
  // The actor emits an { error } item on failure — never a document.
  if (typeof item.error === "string") return null;
  const pageName = typeof item.page_name === "string" ? item.page_name : "";
  // A keyword search matches the word anywhere: q=Waters returned charter
  // boats and cruises ("Kauaʻi's waters"), zero Waters ads (live 2026-09-21).
  // Only an advertiser whose page name carries the searched name is kept.
  const searched = adSearchTerm(target.value);
  if (searched && !advertiserMatches(pageName, searched)) return null;
  const archiveId =
    typeof item.ad_archive_id === "string" ? item.ad_archive_id : "";
  const snapshot = (item.snapshot ?? {}) as Record<string, unknown>;
  const bodyText = adText(snapshot) || (typeof item.body === "string" ? item.body : "");
  if (!archiveId && !bodyText.trim()) return null;
  const canonical = canonicalizeUrl(target.value);
  return {
    sourceUrl: target.value,
    canonicalUrl: `${canonical}#${archiveId}`,
    title: [pageName, archiveId].filter(Boolean).join(" · ") || undefined,
    body: bodyText || `Ad ${archiveId} by ${pageName}`,
    adapter: "apify",
    sourceKind: target.kind,
    contentHash: contentHash(`${canonical}#${archiveId}`, bodyText),
    raw: item,
  };
}

export async function fetchViaWaters(
  spec: ApprovedScanSpec,
): Promise<FetchOutcome> {
  const docs: RawSignalDoc[] = [];
  const failures: FetchOutcome["failures"] = [];
  // Sources that only gave up their content to a rendered crawl. The caller
  // persists this so the wasted plain pass happens once, not every time.
  const escalated: NonNullable<FetchOutcome["escalated"]> = [];
  // Targets Firecrawl could not read and Apify then collected.
  const fallbacks: NonNullable<FetchOutcome["fallbacks"]> = [];
  const picked: NonNullable<FetchOutcome["picked"]> = [];
  const skippedPages: NonNullable<FetchOutcome["skippedPages"]> = [];
  const empty: NonNullable<FetchOutcome["empty"]> = [];
  let remaining = spec.pageBudget;
  let pagesFetched = 0;

  for (const target of spec.targets) {
    if (!isSocialKind(target.kind)) {
      try {
        const parsed = new URL(target.value);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error("not an http(s) URL");
        }
      } catch {
        failures.push({ target: target.value, error: "invalid URL" });
        continue;
      }
    }
    const pages = effectivePages(target, remaining);
    if (pages === 0) {
      failures.push({
        target: target.value,
        error: "daily collection budget exhausted",
      });
      continue;
    }
    // Rung 1 for a single public page: Firecrawl — about a second, JavaScript
    // rendered, 1 credit. A failure another scraper could survive (outage,
    // credits, timeout, bot wall) falls through to the Apify path below; a
    // page that is simply gone (404) is recorded once, without paying Apify
    // to hear the same answer.
    let firecrawlReason: string | null = null;
    const scrapeOptions = {
      maxAgeMs: FIRECRAWL_MAX_AGE_MS,
      ...(extractJsonEnabled() ? { jsonSchema: SIGNAL_SCHEMA, jsonPrompt: SIGNAL_PROMPT } : {}),
    };
    const single = firecrawlPlan(target, pages);
    const site = !single && firecrawlSitePlan(target, pages);
    if (single || site) {
      try {
        if (single) {
          const page = await scrapeWithFirecrawl(target.value, scrapeOptions);
          pagesFetched += 1;
          if (remaining !== undefined) remaining = Math.max(0, remaining - 1);
          docs.push(mapFirecrawlPage(page, target));
          continue;
        }
        // Several pages of one site: read the start page, then the pages
        // the shared picker chose (remembered on the target for a week).
        const collected = await collectSiteWithFirecrawl(target, pages, {
          scrape: (url) => scrapeWithFirecrawl(url, scrapeOptions),
          map: (url) => mapSite(url),
        });
        pagesFetched += collected.pages;
        if (remaining !== undefined) remaining = Math.max(0, remaining - collected.pages);
        docs.push(...collected.docs);
        if (collected.picked) picked.push({ target: target.value, urls: collected.picked });
        skippedPages.push(...collected.skipped);
        continue;
      } catch (thrown) {
        firecrawlReason = thrown instanceof Error ? thrown.message : "Firecrawl failed";
        if (!shouldFallBack(thrown)) {
          failures.push({ target: target.value, error: firecrawlReason });
          continue;
        }
      }
    }

    const social = isSocialKind(target.kind) ? parseSocialRef(target.value) : null;
    const collect = async (renderJs: boolean) => {
      const plan = planTarget({ ...target, renderJs }, pages);
      const items = await runActor(plan.actor, plan.input, plan.memoryMb);
      // Cost is per page returned; an empty run still cost one call.
      const cost = Math.max(1, items.length);
      pagesFetched += cost;
      if (remaining !== undefined) remaining = Math.max(0, remaining - cost);
      return items
        .map((item) =>
          social
            ? mapSocialItem(item, target, social)
            : target.kind === "ad_library"
              ? mapAdItem(item, target)
              : mapPageItem(item, target),
        )
        .filter((d): d is RawSignalDoc => d !== null);
    };

    let mapped: RawSignalDoc[] = [];
    let error: string | null = null;
    try {
      mapped = await collect(Boolean(target.renderJs));
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : "fetch failed";
    }

    // A JavaScript site hands a plain fetch an empty shell, which looks like a
    // successful page and is worse than a failure because nothing says so.
    // One rendered retry, decided by evidence, and remembered afterwards.
    if (!social && target.kind !== "ad_library") {
      const decision = shouldEscalate({
        alreadyRendering: Boolean(target.renderJs),
        docs: mapped,
        error,
        remainingPages: remaining ?? pages,
      });
      if (decision.escalate) {
        try {
          const rendered = await collect(true);
          if (rendered.length > 0) {
            mapped = rendered;
            error = null;
            escalated.push({ target: target.value, reason: decision.reason });
          }
        } catch (thrown) {
          error ??= thrown instanceof Error ? thrown.message : "rendered fetch failed";
        }
      }
    }

    if (error) {
      failures.push({
        target: target.value,
        error: firecrawlReason ? `${error}; before that, ${firecrawlReason}` : error,
      });
      continue;
    }
    if (firecrawlReason && mapped.length > 0) {
      fallbacks.push({ target: target.value, reason: firecrawlReason });
    }
    if (mapped.length === 0) {
      const searched = target.kind === "ad_library" ? adSearchTerm(target.value) : null;
      if (searched) {
        // The search ran and the brand has no active ads: an answer, not a
        // failure. Counted as a failure, a daily source looks due again at
        // once and re-runs a paid actor every few minutes (C7.1, live).
        empty.push({
          target: target.value,
          reason: `no active ads by an advertiser named "${searched}" (other advertisers matching the word were ignored)`,
        });
      } else {
        failures.push({ target: target.value, error: "actor returned no usable items" });
      }
    }
    docs.push(...mapped);
  }

  if (docs.length === 0 && failures.length > 0) {
    throw new Error(
      `every target failed: ${failures.map((f) => `${f.target} (${f.error})`).join("; ")}`,
    );
  }
  return { docs, failures, pages: pagesFetched, escalated, fallbacks, picked, skippedPages, empty };
}

export function registerWatersAdapter() {
  registerAdapter({ key: "apify", fetch: fetchViaWaters });
}
