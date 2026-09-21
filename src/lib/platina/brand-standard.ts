/**
 * Turning a client profile into a declared brand standard (core spine R3).
 * Pure.
 *
 * The divergence stage compares "what we say about ourselves" (Plane A,
 * first-party) against "what competitors are saying now" (Plane B). Until now
 * the only way to get a Plane A standard was to paste brand text by hand, so
 * for every client onboarded through /start the stage skipped forever with
 * "no declared brand standard yet" — fully built machinery that could never
 * run.
 *
 * The client profile is derived from the client's own site, so it is a
 * reasonable draft of that standard. It is NOT promoted automatically: an
 * operator confirms it first (owner decision O3), because a model-derived
 * summary silently becoming first-party truth is exactly the kind of blur the
 * two-layer rule exists to prevent. This module produces the draft; the
 * confirmation is a human action.
 */
import type { ClientProfile } from "@/db/platina-schema";

export type StandardChunk = { title: string; content: string };

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

const list = (items: string[] | undefined) =>
  (items ?? []).map(clean).filter((item) => item.length > 0);

/**
 * One chunk per facet, so retrieval can surface "how they speak" without
 * dragging in "what they sell". Empty facets produce no chunk — an empty
 * heading is not a standard.
 */
export function profileToStandard(
  clientName: string,
  profile: ClientProfile | null | undefined,
): StandardChunk[] {
  if (!profile) return [];
  const name = clean(clientName) || "This client";
  const chunks: StandardChunk[] = [];

  const summary = clean(profile.summary ?? "");
  if (summary) {
    chunks.push({
      title: `${name} — what it does`,
      content: `${name} describes itself as: ${summary}`,
    });
  }

  const offers = list(profile.offers);
  if (offers.length > 0) {
    chunks.push({
      title: `${name} — what it offers`,
      content: `${name} offers: ${offers.join("; ")}.`,
    });
  }

  const audience = clean(profile.audience ?? "");
  const tone = clean(profile.tone ?? "");
  if (audience || tone) {
    chunks.push({
      title: `${name} — who it speaks to, and how`,
      content: [
        audience ? `${name} speaks to: ${audience}.` : "",
        tone ? `Its tone is: ${tone}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    });
  }

  const claims = list(profile.claims);
  if (claims.length > 0) {
    chunks.push({
      title: `${name} — the claims it makes`,
      content: `${name} claims: ${claims.join("; ")}.`,
    });
  }

  return chunks;
}

/** True when a profile carries enough to be worth confirming as a standard. */
export function profileIsConfirmable(profile: ClientProfile | null | undefined): boolean {
  return profileToStandard("x", profile).length > 0;
}
