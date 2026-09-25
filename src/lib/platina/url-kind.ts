/**
 * Any competitor link a person pastes -> the source it becomes (C8.2). Pure.
 *
 *   linkedin.com/company/<slug>      -> their LinkedIn posts (Apify)
 *   facebook.com/ads/library/?q=...  -> the Meta ad library (Apify)
 *   linkedin.com/ad-library/search?accountOwner=... -> the LinkedIn Ad Library (Apify, C8.3)
 *   a page on an event / expo site   -> a conference page (Firecrawl)
 *   /news, /press, /media pages      -> a press release (Firecrawl)
 *   any other web page               -> a competitor page (Firecrawl, 1 page)
 *
 * Refused with a reason instead of guessed: a single LinkedIn post (paste the
 * company page), an Ad Library link without an advertiser, private or
 * non-web addresses. Which company it belongs to is decided by the site or
 * the LinkedIn page when a known brand owns it, else by the person's choice.
 */
import type { PlatinaScanTarget } from "@/db/platina-schema";
import { normaliseIngestUrl, registrableDomain } from "@/lib/ingest/url";
import { advertiserMatches } from "./fetch/actors";

export type UrlKind =
  | { ok: true; kind: PlatinaScanTarget["kind"]; value: string; label: string; reader: "Firecrawl" | "Apify"; host: string | null }
  | { ok: false; reason: string };

const EVENT_WORDS = /\b(expo|exhibition|conference|congress|summit|symposium|trade[- ]?fair|meeting|arablab|pittcon|asms|analytica|slas|cphi|whx|medlab|achema|adlm|duphat)\b/i;
const PRESS_PATH = /\/(news|press|press-releases?|media|newsroom|announcements?)(\/|$)/i;

export function classifyUrl(raw: string): UrlKind {
  const url = normaliseIngestUrl(raw);
  if (!url) return { ok: false, reason: "That is not a web address." };
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "").toLowerCase();

  if (host.endsWith("linkedin.com")) {
    const company = /^\/(company|showcase)\/([^/?#]+)/i.exec(u.pathname);
    if (company) {
      return { ok: true, kind: "social_posts", value: `linkedin:@${company[2].toLowerCase()}`, label: "LinkedIn posts", reader: "Apify", host: null };
    }
    if (/^\/ad-library/i.test(u.pathname)) {
      if (!u.searchParams.get("accountOwner")?.trim()) {
        return { ok: false, reason: "Search the LinkedIn Ad Library by advertiser first, then paste that search (its link has ?accountOwner=...)." };
      }
      return { ok: true, kind: "ad_library", value: url, label: "LinkedIn ad library", reader: "Apify", host: null };
    }
    return { ok: false, reason: "That is a single LinkedIn post or profile. Paste the company page (linkedin.com/company/...) to follow all its posts." };
  }
  if (host.endsWith("facebook.com") && /^\/ads\/library/i.test(u.pathname)) {
    return { ok: true, kind: "ad_library", value: url, label: "Meta ad library", reader: "Apify", host: null };
  }
  if (/(^|\.)(facebook|instagram|tiktok|x|twitter|youtube)\.com$/.test(host)) {
    return { ok: false, reason: "Social pages other than LinkedIn are not read yet; paste the company's website or LinkedIn page." };
  }
  const site = registrableDomain(host);
  if (EVENT_WORDS.test(`${host} ${u.pathname}`)) {
    return { ok: true, kind: "conference", value: url, label: "Event page", reader: "Firecrawl", host: site };
  }
  if (PRESS_PATH.test(u.pathname)) {
    return { ok: true, kind: "press_release", value: url, label: "News or press page", reader: "Firecrawl", host: site };
  }
  return { ok: true, kind: "competitor_site", value: url, label: "Web page", reader: "Firecrawl", host: site };
}

/** The brand that owns this link by its site or LinkedIn page, if one does. */
export function ownerOf(
  kind: Extract<UrlKind, { ok: true }>,
  brands: { id: string; name: string; kind: string; homepageUrl: string | null; handles?: { linkedin?: string } | null }[],
): { id: string; name: string; kind: string } | null {
  if (kind.kind === "social_posts") {
    const slug = kind.value.replace(/^linkedin:@/, "");
    return brands.find((b) => b.handles?.linkedin?.replace(/^@/, "").toLowerCase() === slug) ?? null;
  }
  if (kind.kind === "ad_library") {
    // The advertiser searched for: "Thermo Fisher Scientific" belongs to "Thermo Fisher".
    const params = new URL(kind.value).searchParams;
    const searched = params.get("accountOwner") ?? params.get("q");
    return searched ? (brands.find((b) => advertiserMatches(searched, b.name)) ?? null) : null;
  }
  if (!kind.host) return null;
  return (
    brands.find((b) => {
      if (!b.homepageUrl) return false;
      try {
        return registrableDomain(new URL(b.homepageUrl).hostname.replace(/^www\./, "")) === kind.host;
      } catch {
        return false;
      }
    }) ?? null
  );
}
