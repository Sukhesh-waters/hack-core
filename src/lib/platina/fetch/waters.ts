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
  effectivePages,
  isSocialKind,
  mapSocialItem,
  parseSocialRef,
  planTarget,
} from "./actors";
import { canonicalizeUrl, contentHash } from "./canonical";
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
  const memory = memoryMb ? `&memory=${memoryMb}` : "";
  const res = await fetch(
    `${APIFY_BASE}/${actorSlug}/run-sync-get-dataset-items?token=${token}${memory}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
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

function mapAdItem(
  item: Record<string, unknown>,
  target: PlatinaScanTarget,
): RawSignalDoc | null {
  // The actor emits an { error } item on failure — never a document.
  if (typeof item.error === "string") return null;
  const pageName = typeof item.page_name === "string" ? item.page_name : "";
  const archiveId =
    typeof item.ad_archive_id === "string" ? item.ad_archive_id : "";
  const snapshot = (item.snapshot ?? {}) as Record<string, unknown>;
  const bodyText =
    (typeof snapshot.body === "string" && snapshot.body) ||
    (typeof item.body === "string" && (item.body as string)) ||
    "";
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
      failures.push({ target: target.value, error });
      continue;
    }
    if (mapped.length === 0) {
      failures.push({
        target: target.value,
        error: "actor returned no usable items",
      });
    }
    docs.push(...mapped);
  }

  if (docs.length === 0 && failures.length > 0) {
    throw new Error(
      `every target failed: ${failures.map((f) => `${f.target} (${f.error})`).join("; ")}`,
    );
  }
  return { docs, failures, pages: pagesFetched, escalated };
}

export function registerWatersAdapter() {
  registerAdapter({ key: "apify", fetch: fetchViaWaters });
}
