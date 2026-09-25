/**
 * URL clean-up for anything a person pastes to be read (C7.0). Pure, shared
 * by InstaMedia's knowledge ingest and Platina's source intake.
 *
 * The live Waters vault held the same homepage seven times: once as
 * `https:/www.waters.com`, twice with Google's `srsltid`, and so on. One
 * normal form makes "already in the knowledge base" a string comparison.
 */

/** Query parameters that only identify the click, never the page. */
const TRACKING = /^(utm_|srsltid$|trk$|trkinfo$|fbclid$|gclid$|gclsrc$|dclid$|msclkid$|mc_cid$|mc_eid$|_hs|igshid$|ref_src$)/i;

/** Second-level public suffixes common among the clients we serve. */
const TWO_LEVEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au",
  "co.jp", "ne.jp", "or.jp",
  "com.cn", "com.hk", "com.sg", "com.my", "co.in", "co.kr", "com.tw",
  "com.br", "com.mx", "com.ar", "co.za", "co.nz",
  "com.sa", "com.qa", "com.kw", "com.om", "com.bh", "co.ae", "gov.ae",
  "com.tr", "com.eg",
]);

/**
 * The canonical form of a pasted URL, or null when it is not an http(s) URL.
 * Repairs a single-slash scheme, adds https to a bare host, lower-cases the
 * host, drops the fragment, tracking parameters and a trailing slash.
 */
export function normaliseIngestUrl(raw: string): string | null {
  let text = raw.trim();
  if (!text) return null;
  text = text.replace(/^(https?):\/(?!\/)/i, "$1://");
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    if (!/^[\w-]+(\.[\w-]+)+([/:?#]|$)/.test(text)) return null;
    text = `https://${text}`;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;

  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  const kept = [...url.searchParams.entries()].filter(([key]) => !TRACKING.test(key));
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);
  if (url.pathname !== "/" && url.pathname.endsWith("/")) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

/** "ir.waters.com" -> "waters.com"; "shop.example.co.uk" -> "example.co.uk". */
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  return TWO_LEVEL_SUFFIXES.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

/** True when `host` is `domain` or one of its subdomains (www. ignored on both). */
export function hostMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  const d = domain.toLowerCase().replace(/^www\./, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return h === d || h.endsWith(`.${d}`);
}
