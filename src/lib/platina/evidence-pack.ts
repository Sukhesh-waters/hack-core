/**
 * Evidence packs (C8.0 F0.6). When an operator (a person, or Claude acting
 * for the owner) finds public pages by research, they come in as a pack:
 * each item is a URL, the sentence on it that matters, and why. Pure rules
 * here; scripts/import-evidence-pack.ts does the reading and writing.
 *
 * An item becomes a Plane B signal document ONLY if the page, read through
 * Firecrawl like any other public page, really contains the quoted
 * sentence. Nothing typed into the pack is stored as a fact: the stored
 * body is the page as read, and the quote is kept as the reason it was
 * brought in. The client's own pages are refused here — they are
 * first-party and belong to the own-site pass (Plane A), never Plane B.
 */
import { z } from "zod";
import { hostMatches, normaliseIngestUrl } from "@/lib/ingest/url";
import type { PlatinaScanTarget } from "@/db/platina-schema";
import { quotedIn } from "./events";

export const PACK_KINDS = ["competitor_site", "press_release", "trade_editorial", "conference"] as const;
export type PackKind = (typeof PACK_KINDS)[number];

const itemSchema = z.object({
  url: z.string().min(8),
  /** The sentence on the page that matters, copied exactly. */
  quote: z.string().trim().min(12).max(400),
  why: z.string().trim().min(5).max(300),
  /** Company the page is about (a client or competitor name), or null for the market. */
  subject: z.string().trim().min(2).nullable().default(null),
  kind: z.enum(PACK_KINDS).default("competitor_site"),
});

export const packSchema = z.object({
  gatheredBy: z.string().trim().min(2),
  gatheredAt: z.string().trim().min(8),
  items: z.array(itemSchema).min(1).max(50),
});

export type EvidencePack = z.infer<typeof packSchema>;
export type PackItem = z.infer<typeof itemSchema>;

export type PackBrand = { id: string; name: string; kind: string; homepageUrl: string | null };

export type Triage =
  | { action: "read"; url: string; brandId: string | null; brandName: string | null; kind: PackKind; item: PackItem }
  | { action: "refuse"; url: string; reason: string };

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function brandOfHost(host: string, brands: PackBrand[]): PackBrand | null {
  return brands.find((b) => b.homepageUrl && hostOf(b.homepageUrl) && hostMatches(host, hostOf(b.homepageUrl)!)) ?? null;
}

/**
 * Decides what happens to one item before anything is read. The page's host
 * decides whose page it is when it matches a known site; the stated subject
 * decides otherwise (a trade article about Agilent lives on a trade site).
 */
export function triageItem(item: PackItem, brands: PackBrand[]): Triage {
  const url = normaliseIngestUrl(item.url);
  if (!url) return { action: "refuse", url: item.url, reason: "not a web address" };
  const host = hostOf(url)!;

  const byHost = brandOfHost(host, brands);
  if (byHost?.kind === "own_brand") {
    return {
      action: "refuse",
      url,
      reason: `${byHost.name}'s own page: first-party, read by the own-site pass, never stored as public data`,
    };
  }

  let brand = byHost;
  if (!brand && item.subject) {
    brand = brands.find((b) => b.name.toLowerCase() === item.subject!.toLowerCase()) ?? null;
    if (!brand) {
      return {
        action: "refuse",
        url,
        reason: `"${item.subject}" is not a tracked company: add it as a competitor or market source first`,
      };
    }
  }
  return {
    action: "read",
    url,
    brandId: brand?.id ?? null,
    brandName: brand?.name ?? null,
    kind: item.kind,
    item,
  };
}

/** The page as read must contain the quote; otherwise the item is dropped. */
export function quoteHolds(quote: string, page: { markdown: string; title?: string }): boolean {
  return quotedIn(quote, `${page.title ?? ""}\n${page.markdown}`);
}

/** One operator-evidence source per company (or the market), holding every pack URL for it. */
export function evidenceSourceName(brandName: string | null): string {
  return `${brandName ?? "Market"} · operator evidence`;
}

export function packTarget(kind: PackKind, url: string): PlatinaScanTarget {
  return { kind, value: url, maxPages: 1 };
}

/** Marks a stored document as operator-brought, with the reason, on its raw record. */
export function packProvenance(
  pack: Pick<EvidencePack, "gatheredBy" | "gatheredAt">,
  item: PackItem,
): Record<string, unknown> {
  return {
    origin: "operator_pack",
    gatheredBy: pack.gatheredBy,
    gatheredAt: pack.gatheredAt,
    quote: item.quote,
    why: item.why,
  };
}
