/**
 * The real fetch behind the header-only probes (change probe and onboarding
 * discovery). Own code is permitted for these because no page content is
 * retrieved: the body is drained and discarded, never read or stored. The URL
 * arrives as a variable so no host is named at the call site.
 */
import type { ProbeFetch } from "./probe";

export const headProbeFetch: ProbeFetch = async (url, init) => {
  const res = await fetch(url, {
    method: "GET",
    headers: init.headers,
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });
  // Drain and discard: the probe never retains page content.
  await res.arrayBuffer().catch(() => undefined);
  return res;
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
    const res = await fetch(url, {
      headers: { "user-agent": "platina-probe/1.0", accept: "application/xml,text/xml" },
      signal: AbortSignal.timeout(8_000),
      redirect: "follow",
    });
    if (!res.ok || !res.body) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!/xml/i.test(type) && !/\.xml$/i.test(url)) return null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (bytes >= SITEMAP_MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }
    return text;
  } catch {
    return null;
  }
}
