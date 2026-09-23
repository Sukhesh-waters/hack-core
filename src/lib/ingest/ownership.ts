/**
 * Whose page is this? (C7.0, two-layer rule.) Pure, shared by InstaMedia's
 * knowledge ingest and Platina's source intake.
 *
 * First-party ingest is an allowlist: a URL is "own" only when it matches one
 * of the client's own identities (its domains and social pages). Everything
 * else is someone else's, named when we know whose, and belongs in the public
 * layer. Found live 2026-09-22: 42 of Waters' 67 first-party passages were
 * Thermo Fisher, Agilent and Pfizer pages pasted into the vault.
 */
import { hostMatches, normaliseIngestUrl, registrableDomain } from "./url";

export type IdentityKind = "domain" | "linkedin" | "instagram" | "tiktok" | "youtube" | "x" | "facebook";

/**
 * domain: "waters.com" (subdomains included).
 * linkedin: "company/waters", "showcase/bdbiosciences", "in/<person>", or
 *   "*\/<slug>" for a post whose author type the URL does not say.
 * others: the lower-case handle, without "@".
 */
export type Identity = { kind: IdentityKind; value: string };

export type KnownParty = { name: string; identities: Identity[] };

export type Ownership =
  | { verdict: "own"; identity: Identity }
  | { verdict: "third_party"; name: string }
  | { verdict: "unknown"; suggestion: Identity | null };

const SOCIAL_HOSTS: Record<string, IdentityKind> = {
  "linkedin.com": "linkedin",
  "instagram.com": "instagram",
  "tiktok.com": "tiktok",
  "youtube.com": "youtube",
  "x.com": "x",
  "twitter.com": "x",
  "facebook.com": "facebook",
};

const RESERVED = new Set(["p", "reel", "reels", "stories", "explore", "watch", "channel", "c", "user", "feed", "search", "hashtag", "i", "share", "sharer", "groups", "events", "ads", "pages", "tag", "discover"]);

/** The identity a URL belongs to, or null when it cannot be told (a feed, a search page). */
export function identityOfUrl(raw: string): Identity | null {
  const normal = normaliseIngestUrl(raw);
  if (!normal) return null;
  const url = new URL(normal);
  const site = registrableDomain(url.hostname);
  const kind = SOCIAL_HOSTS[site];
  if (!kind) return { kind: "domain", value: site };

  const parts = url.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p).toLowerCase());
  if (kind === "linkedin") {
    const [type, slug] = parts;
    if ((type === "company" || type === "showcase" || type === "school" || type === "in") && slug) {
      return { kind, value: `${type}/${slug}` };
    }
    // /posts/waters_the-26th-... : the author's vanity name comes before the first "_".
    if (type === "posts" && slug && slug.includes("_")) return { kind, value: `*/${slug.split("_")[0]}` };
    return null;
  }
  const first = parts[0];
  if (!first) return null;
  if (kind === "youtube" && (first === "c" || first === "user") && parts[1]) return { kind, value: parts[1] };
  const handle = first.replace(/^@/, "");
  if (!handle || RESERVED.has(handle)) return null;
  return { kind, value: handle };
}

/** Parses what a person types into the own-sites list: a domain or a profile URL. */
export function parseIdentity(text: string): Identity | null {
  const identity = identityOfUrl(text);
  if (!identity || identity.value.startsWith("*/")) return null;
  return identity;
}

function matches(found: Identity, candidate: Identity): boolean {
  if (found.kind !== candidate.kind) return false;
  if (found.kind === "domain") return hostMatches(found.value, candidate.value);
  if (found.kind !== "linkedin") return found.value === candidate.value.toLowerCase().replace(/^@/, "");
  const [fType, fSlug] = found.value.split("/");
  const [cType, cSlug] = candidate.value.toLowerCase().split("/");
  return fSlug === cSlug && (fType === "*" || fType === cType);
}

export function ownershipOf(url: string, parties: { own: Identity[]; known: KnownParty[] }): Ownership {
  const found = identityOfUrl(url);
  if (!found) return { verdict: "unknown", suggestion: null };
  const own = parties.own.find((o) => matches(found, o));
  if (own) return { verdict: "own", identity: own };
  const known = parties.known.find((p) => p.identities.some((i) => matches(found, i)));
  if (known) return { verdict: "third_party", name: known.name };
  if (found.kind === "linkedin" && found.value.startsWith("*/")) {
    return { verdict: "unknown", suggestion: { kind: "linkedin", value: `company/${found.value.slice(2)}` } };
  }
  return { verdict: "unknown", suggestion: found };
}

/** "waters.com", "LinkedIn company/waters" — for messages and the own-sites list. */
export function describeIdentity(identity: Identity): string {
  if (identity.kind === "domain") return identity.value;
  const label = { linkedin: "LinkedIn", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", x: "X", facebook: "Facebook" }[identity.kind];
  return `${label} ${identity.kind === "linkedin" ? identity.value : `@${identity.value}`}`;
}
