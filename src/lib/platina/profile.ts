/**
 * Client profile (core spine): what we understand about a client from its OWN
 * public pages, produced right after the first scrape so a pasted URL turns
 * into visible analysis, not a silent queue.
 *
 * First-party derived context — never evidence. The planner sees it as "how
 * this client speaks and what it sells", separate from the public market
 * evidence it may cite (two-layer rule). Pure: prompt building and parsing.
 */
import { extractJson } from "./json";
import { z } from "zod";
import type { ClientProfile } from "@/db/platina-schema";

export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileError";
  }
}

export type ProfilePage = {
  url: string;
  kind: string | null;
  title: string | null;
  body: string;
  fetchedAt: Date | string;
};

export const PROFILE_MAX_PAGES = 6;
export const PROFILE_PER_PAGE_CHARS = 1800;
export const PROFILE_TOTAL_CHARS = 7000;

const pathDepth = (url: string) => {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return 99;
  }
};
const time = (d: Date | string) => new Date(d).getTime();

/**
 * Newest copy of each URL, the shallowest pages first (a homepage says more
 * about a company than a deep article), bounded so one call stays small.
 * Never cuts a page mid-way beyond the per-page limit.
 */
export function selectProfilePages(rows: ProfilePage[]): ProfilePage[] {
  const newest = new Map<string, ProfilePage>();
  for (const r of rows) {
    if (!r.body.trim()) continue;
    const seen = newest.get(r.url);
    if (!seen || time(r.fetchedAt) > time(seen.fetchedAt)) newest.set(r.url, r);
  }
  const ordered = [...newest.values()].sort(
    (a, b) =>
      pathDepth(a.url) - pathDepth(b.url) ||
      time(b.fetchedAt) - time(a.fetchedAt),
  );
  const out: ProfilePage[] = [];
  let used = 0;
  for (const page of ordered) {
    if (out.length >= PROFILE_MAX_PAGES) break;
    const body = page.body
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, PROFILE_PER_PAGE_CHARS);
    if (used + body.length > PROFILE_TOTAL_CHARS && out.length > 0) break;
    out.push({ ...page, body });
    used += body.length;
  }
  return out;
}

export function buildProfilePrompt(
  clientName: string,
  pages: ProfilePage[],
): string {
  return [
    `Client: ${clientName}`,
    "Pages from the client's OWN public website (scraped):",
    ...pages.map(
      (p, i) =>
        `[${i + 1}] ${p.url}${p.title ? ` — ${p.title}` : ""}\n${p.body}`,
    ),
    "Describe this client strictly from these pages. Do not use outside knowledge and do not invent. If the pages do not support a field, leave it empty. State claims the way the site states them.",
    'Reply with JSON only: {"summary":string,"offers":string[],"audience":string,"tone":string,"keywords":string[],"claims":string[]}. summary: what the company does, one or two sentences. offers: main products or services. audience: who it sells to. tone: how it speaks, a few words. keywords: recurring terms. claims: notable claims it makes about itself.',
  ].join("\n\n");
}

const text = (max: number) =>
  z
    .string()
    .default("")
    .transform((s) => s.trim().slice(0, max));
const list = (items: number, each: number) =>
  z
    .array(z.string())
    .default([])
    .transform((a) =>
      a
        .map((s) => s.trim().slice(0, each))
        .filter(Boolean)
        .slice(0, items),
    );

// Lenient on length (a verbose reply is trimmed, not rejected); strict that a
// summary exists — a profile with nothing in it is a failure, not an answer.
const profileSchema = z.object({
  summary: text(400),
  offers: list(6, 100),
  audience: text(200),
  tone: text(160),
  keywords: list(10, 40),
  claims: list(5, 160),
});

export function parseProfile(raw: string): ClientProfile {
  let parsed: z.infer<typeof profileSchema>;
  try {
    parsed = profileSchema.parse(extractJson(raw));
  } catch (error) {
    throw new ProfileError(
      `The analysis returned an unusable result: ${error instanceof Error ? error.message.slice(0, 120) : "unknown"}`,
    );
  }
  if (parsed.summary.length < 10) {
    throw new ProfileError(
      "The pages did not say enough to describe this client.",
    );
  }
  return parsed;
}

/** One sentence per fact, for the planner prompt. Empty fields are omitted, not faked. */
export function renderProfile(profile: ClientProfile): string {
  return [
    `What they do: ${profile.summary}`,
    profile.offers.length ? `Offers: ${profile.offers.join("; ")}` : "",
    profile.audience ? `Audience: ${profile.audience}` : "",
    profile.tone ? `Tone: ${profile.tone}` : "",
    profile.claims.length
      ? `Claims they make: ${profile.claims.join("; ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
