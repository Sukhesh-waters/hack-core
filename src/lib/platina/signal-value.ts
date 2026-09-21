/**
 * Signal triage (core spine R1). Pure: is this collected document worth two
 * model calls and an embedding?
 *
 * Every crawled page used to be analysed — cookie banners, careers pages,
 * "Contact sales" forms — which is both why the daily analysis cap filled with
 * noise and why the findings list read like a sitemap. Collection stays cheap
 * and keeps everything; ANALYSIS is what this gate protects.
 *
 * A filtered document is never deleted and never silent: it is marked
 * processed with the reason below, and the reason is shown to the operator.
 *
 * No IO, no clock, no randomness — same input, same verdict, forever.
 */

export type SignalValueVerdict = {
  worthAnalysing: boolean;
  /** Plain language, shown in the UI. Never empty when worthAnalysing is false. */
  reason: string;
  /** 0..1 — orders the analysis queue when the daily budget is tight. */
  score: number;
};

/** Below this much prose there is nothing to reason about. */
export const MIN_PROSE_CHARS = 400;
/** Above this share of short lines, a page is a menu, not an argument. */
export const NAV_LINE_RATIO = 0.6;
const NAV_LINE_CHARS = 40;
/** A page needs this many lines before the navigation heuristic means anything. */
const NAV_MIN_LINES = 8;

/**
 * Path segments that are the same on every site and carry no market signal.
 * Matched against whole path SEGMENTS, never as a substring of the URL — a
 * competitor called "Contact Ltd" at contact-ltd.com must not be filtered.
 */
const BOILERPLATE: { test: RegExp; label: string }[] = [
  { test: /^(privacy|privacy-policy|datenschutz)$/, label: "a privacy policy" },
  { test: /^(terms|terms-of-service|tos|legal|imprint|impressum)$/, label: "legal boilerplate" },
  { test: /^(cookie|cookies|cookie-policy)$/, label: "a cookie notice" },
  { test: /^(careers|jobs|job|vacancies|hiring)$/, label: "a careers page" },
  { test: /^(login|signin|sign-in|signup|sign-up|register|account)$/, label: "a sign-in page" },
  { test: /^(cart|checkout|basket|order)$/, label: "a checkout page" },
  { test: /^(contact|contact-us|support|help|faq)$/, label: "a contact or support page" },
  { test: /^(sitemap|sitemap\.xml|rss|feed|atom\.xml)$/, label: "a sitemap or feed" },
  { test: /^(search|404|not-found|unsubscribe)$/, label: "a utility page" },
];

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

function pathSegments(url: string): string[] {
  try {
    return new URL(url).pathname.toLowerCase().split("/").filter(Boolean);
  } catch {
    return [];
  }
}

/** The boilerplate class this URL belongs to, or null. */
export function boilerplateReason(url: string): string | null {
  for (const segment of pathSegments(url)) {
    const hit = BOILERPLATE.find((entry) => entry.test.test(segment));
    if (hit) return hit.label;
  }
  return null;
}

/** Share of lines short enough to be menu items. */
export function navigationRatio(body: string): number {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < NAV_MIN_LINES) return 0;
  const short = lines.filter((line) => line.length < NAV_LINE_CHARS).length;
  return short / lines.length;
}

/** Source kinds that are published deliberately, so they start higher. */
const KIND_WEIGHT: Record<string, number> = {
  press_release: 0.3,
  trade_editorial: 0.25,
  conference: 0.2,
  ad_library: 0.2,
  social_posts: 0.2,
  social_profile: 0.1,
  competitor_site: 0.1,
};

export function scoreSignal(input: {
  url: string;
  title: string | null;
  body: string;
  sourceKind: string | null;
  /** Social documents carry measurements; a short caption is still a signal. */
  metricsPresent?: boolean;
}): SignalValueVerdict {
  const prose = collapse(input.body);

  const boilerplate = boilerplateReason(input.url);
  if (boilerplate) {
    return {
      worthAnalysing: false,
      reason: `Skipped: ${boilerplate}, which says nothing about the market.`,
      score: 0,
    };
  }

  if (!input.metricsPresent && prose.length < MIN_PROSE_CHARS) {
    return {
      worthAnalysing: false,
      reason: `Skipped: only ${prose.length} characters of text — too little to draw anything from.`,
      score: 0,
    };
  }

  const navRatio = navigationRatio(input.body);
  if (!input.metricsPresent && navRatio > NAV_LINE_RATIO) {
    return {
      worthAnalysing: false,
      reason: `Skipped: ${Math.round(navRatio * 100)}% of this page is short link text — it looks like navigation, not content.`,
      score: 0,
    };
  }

  // Worth reading. The score only orders the queue; it never gates.
  const lengthScore = Math.min(0.4, prose.length / 10_000);
  const specifics =
    (/\d{4}/.test(prose) ? 0.1 : 0) + // a year
    (/\d+\s?%/.test(prose) ? 0.1 : 0) + // a percentage
    (/[$€£]\s?\d/.test(prose) ? 0.1 : 0); // a price
  const kind = KIND_WEIGHT[input.sourceKind ?? ""] ?? 0.05;
  const metrics = input.metricsPresent ? 0.1 : 0;

  return {
    worthAnalysing: true,
    reason: "",
    score: Math.min(1, Number((lengthScore + specifics + kind + metrics).toFixed(3))),
  };
}
