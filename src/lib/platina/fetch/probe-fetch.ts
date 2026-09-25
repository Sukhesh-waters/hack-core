/**
 * The real fetch behind the header-only probes (change probe and onboarding
 * discovery). Own code is permitted for these because no page content is
 * retrieved: the body is capped, drained and discarded, never read or stored.
 * The URL arrives as a variable so no host is named at the call site.
 *
 * Both go through safeFetch (C7.0): a probe URL comes from a person or a
 * sitemap, so internal addresses are refused on every redirect hop.
 */
import { safeFetch } from "@/lib/net/safe-fetch";
import type { ProbeFetch } from "./probe";

/** A probe only needs headers; this is the most body it will even drain. */
const PROBE_MAX_BYTES = 64 * 1024;

export const headProbeFetch: ProbeFetch = async (url, init) => {
  const res = await safeFetch(url, {
    method: "GET",
    headers: init.headers,
    timeoutMs: 15_000,
    maxBytes: PROBE_MAX_BYTES,
  });
  return { status: res.status, headers: res.headers };
};

const SITEMAP_MAX_BYTES = 512 * 1024;

/**
 * Reads a sitemap's text, bounded. A sitemap is site metadata (a URL list),
 * not page content; it is the one body own code reads, and only for source
 * discovery. Returns null for anything that is not a reachable XML document.
 * The URL arrives as a variable so no host is named at the call site.
 */
export async function fetchSitemapText(url: string): Promise<string | null> {
  try {
    const res = await safeFetch(url, {
      headers: { "user-agent": "platina-probe/1.0", accept: "application/xml,text/xml" },
      timeoutMs: 8_000,
      maxBytes: SITEMAP_MAX_BYTES,
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!/xml/i.test(type) && !/\.xml$/i.test(url)) return null;
    return await res.text();
  } catch {
    return null;
  }
}
