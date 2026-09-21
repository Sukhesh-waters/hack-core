/**
 * Discovery probe (core spine S2): which derived candidates actually exist?
 * Header-only — the constitution permits own-code probes that retrieve no page
 * content, so every response body is discarded and nothing is parsed. Content
 * retrieval stays Apify-only. (Reading a sitemap's <loc> entries is deliberately
 * NOT done here; that reading is an owner question, not an assumption.)
 *
 * The fetch is injected so this stays unit-testable and never names a host.
 */
import type { ProbeFetch } from "../fetch/probe";
import type { SourceCandidate } from "./derive";

export type Discovered = SourceCandidate & {
  /** true = answered OK, false = clearly absent, null = could not tell. */
  exists: boolean | null;
};

const CONCURRENCY = 5;

async function exists(url: string, fetchImpl: ProbeFetch): Promise<boolean | null> {
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { "user-agent": "platina-probe/1.0" },
    });
    if (res.status >= 200 && res.status < 400) return true;
    if (res.status === 404 || res.status === 410) return false;
    // 401/403/429/5xx: a WAF or an outage, not proof of absence.
    return null;
  } catch {
    return null;
  }
}

/**
 * Social and ad-library candidates are not probed. A social handle is the
 * operator's word, and an ad-library search always answers 200 whether or not
 * the brand runs ads — so probing it would upgrade it to "likely", pre-tick
 * it, and spend the actor's 10-result minimum on a guess. A path that is
 * absent is downgraded, never dropped: the operator sees it and decides.
 */
export async function discoverCandidates(
  candidates: SourceCandidate[],
  fetchImpl: ProbeFetch,
): Promise<Discovered[]> {
  const results: Discovered[] = new Array(candidates.length);
  let next = 0;
  async function worker() {
    while (next < candidates.length) {
      const i = next++;
      const c = candidates[i];
      const unprobeable =
        c.kind === "social_profile" ||
        c.kind === "social_posts" ||
        c.kind === "ad_library";
      const found = unprobeable ? null : await exists(c.value, fetchImpl);
      results[i] = {
        ...c,
        exists: found,
        confidence:
          found === true && c.confidence === "guess" ? "likely" : c.confidence,
      };
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, worker),
  );
  return results;
}

/** Should this candidate start ticked? Certain sources and confirmed paths only. */
export function preselected(c: Discovered): boolean {
  if (c.discovery) return false;
  return c.confidence === "certain" || c.exists === true;
}

export const sitemapFound = (found: Discovered[]): boolean =>
  found.some((c) => c.discovery && c.value.endsWith("sitemap.xml") && c.exists === true);
