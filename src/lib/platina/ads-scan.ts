/**
 * Scan now (C8.3): which advertisers an ad scan reads, how many ads at most,
 * what that can cost, and whether the month's Apify money allows it. Pure —
 * the Ads page button and `npm run platina:ads-sweep` share it, so the
 * person and Claude see the same plan and hit the same gate.
 */
import type { PlatinaScanTarget } from "@/db/platina-schema";
import { MAX_PAGES_CEILING, adSearchTerm, isLinkedInAdLibrary, linkedInAdSearchUrl } from "./fetch/actors";

/** LinkedIn Ad Library actor, ad with details (live price 2026-09-24, free tier). */
export const LINKEDIN_AD_PRICE_USD = 0.004;
/** Most ads read per advertiser in one scan (one ad = one page of budget). */
export const ADS_PER_ADVERTISER = MAX_PAGES_CEILING;
/** Kept back for the scheduled collections (same reserve as a force run). */
export const APIFY_RESERVE_USD = 1;

export type ScanBrand = { id: string; name: string; isClient: boolean };
export type ScanSpecRow = { id: string; brandId: string | null; status: string; targets: PlatinaScanTarget[] };

export type AdScanRow = {
  brandId: string;
  name: string;
  isClient: boolean;
  /** The advertiser's exact LinkedIn name (the library's search is fuzzy). */
  advertiser: string;
  url: string;
  /** The approved source this reads through, if one exists already. */
  specId: string | null;
  maxAds: number;
};

export type AdScanPlan = {
  rows: AdScanRow[];
  maxAds: number;
  projectedUsd: number;
  /** What Apify says is left this month, less the reserve; null = could not read. */
  spendableUsd: number | null;
  allowed: boolean;
  reason: string | null;
};

/** The LinkedIn ad source a brand already has (approved or not), if any. */
export function linkedInAdSpec(specs: ScanSpecRow[], brandId: string): ScanSpecRow | null {
  return specs.find((s) => s.brandId === brandId && s.targets.some((t) => t.kind === "ad_library" && isLinkedInAdLibrary(t.value))) ?? null;
}

export function planAdScan(input: {
  brands: ScanBrand[];
  specs: ScanSpecRow[];
  /** Advertiser names typed on the page or passed to the sweep, by brand id. */
  advertisers?: Map<string, string>;
  perAdvertiser?: number;
  apify: { usedUsd: number; capUsd: number | null } | null;
  approveOver?: boolean;
}): AdScanPlan {
  const per = Math.max(1, Math.min(ADS_PER_ADVERTISER, Math.floor(input.perAdvertiser ?? ADS_PER_ADVERTISER)));
  const rows = input.brands.map((b) => {
    const spec = linkedInAdSpec(input.specs, b.id);
    const current = spec?.targets.find((t) => t.kind === "ad_library" && isLinkedInAdLibrary(t.value));
    const advertiser = input.advertisers?.get(b.id)?.trim() || (current ? adSearchTerm(current.value) : null) || b.name;
    return { brandId: b.id, name: b.name, isClient: b.isClient, advertiser, url: linkedInAdSearchUrl(advertiser), specId: spec?.id ?? null, maxAds: per };
  });
  const maxAds = rows.reduce((s, r) => s + r.maxAds, 0);
  const projectedUsd = Math.round(maxAds * LINKEDIN_AD_PRICE_USD * 100) / 100;
  const spendableUsd =
    input.apify && input.apify.capUsd !== null
      ? Math.max(0, Math.round((input.apify.capUsd - input.apify.usedUsd - APIFY_RESERVE_USD) * 100) / 100)
      : null;
  let reason: string | null = null;
  if (rows.length === 0) reason = "No client and competitors to scan yet.";
  else if (spendableUsd === null && !input.approveOver) reason = "Could not read this month's Apify usage, so a paid scan is not started.";
  else if (spendableUsd !== null && projectedUsd > spendableUsd && !input.approveOver) {
    reason = `This scan can cost up to $${projectedUsd.toFixed(2)}; $${spendableUsd.toFixed(2)} is left this month after the $${APIFY_RESERVE_USD} reserve for scheduled collection.`;
  }
  return { rows, maxAds, projectedUsd, spendableUsd, allowed: reason === null, reason };
}
