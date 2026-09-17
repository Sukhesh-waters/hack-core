/**
 * URL canonicalization and content hashing for signal dedupe. Pure.
 *
 * Dedupe key = sha256(canonical URL + normalized body). The unique index on
 * (scan_spec_id, content_hash) makes an unchanged re-fetch physically
 * uninsertable — dedupe is not a convention, it is a constraint.
 */
import { createHash } from "node:crypto";

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|_hs)/i;

export function canonicalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  const params = [...url.searchParams.entries()].filter(
    ([key]) => !TRACKING_PARAMS.test(key),
  );
  params.sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [key, value] of params) url.searchParams.append(key, value);
  // Normalize the trailing slash on path-only URLs so /page and /page/ hash
  // identically.
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

/** Normalize whitespace before hashing so rendering noise cannot defeat
 *  dedupe. */
export function contentHash(canonicalUrl: string, body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  return createHash("sha256")
    .update(`${canonicalUrl}\n${normalized}`)
    .digest("hex");
}
