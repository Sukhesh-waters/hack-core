/**
 * The first-party ingest decision (C7.0). Pure: given a pasted URL, the
 * client's own identities and the workspace's known competitors, either let
 * the ingest proceed (with the clean URL) or refuse with a message a person
 * can act on. A known competitor's page is never accepted as own, even when
 * the person ticks "it's ours" — that is the leak this exists to stop.
 */
import { describeIdentity, ownershipOf, type Identity, type KnownParty } from "./ownership";
import { normaliseIngestUrl } from "./url";

export type IngestRefusal = {
  /** The clean URL, so the page can hand it to Competitors. */
  url: string | null;
  /** Whose page it is, when we know. */
  ownerName: string | null;
  /** What "it's ours" would add to the client's own list; null when nothing can be added. */
  suggestion: Identity | null;
};

export type IngestDecision =
  | { action: "proceed"; url: string; addIdentity: Identity | null }
  | { action: "refuse"; message: string; refusal: IngestRefusal };

/**
 * May the weekly refresh re-read this stored source? Only while it is still
 * one of the client's own pages. A client with no own list yet (set up before
 * C7.0) keeps refreshing until someone fills the list in, so nothing a
 * working client relies on goes dark overnight; the ops board flags it.
 */
export function refreshAllowed(url: string, own: Identity[]): boolean {
  if (own.length === 0) return true;
  return ownershipOf(url, { own, known: [] }).verdict === "own";
}

export const NOT_OWN_REASON =
  "Not one of the client's own pages, so it is no longer refreshed into the knowledge base. Track it as a competitor or market source instead.";

export function decideIngest(input: {
  url: string;
  clientName: string;
  own: Identity[];
  known: KnownParty[];
  /** The person ticked "This is <client>'s own". */
  confirmOwn: boolean;
}): IngestDecision {
  const url = normaliseIngestUrl(input.url);
  if (!url) {
    return {
      action: "refuse",
      message: "Enter a web address that starts with http:// or https://.",
      refusal: { url: null, ownerName: null, suggestion: null },
    };
  }
  const who = ownershipOf(url, { own: input.own, known: input.known });
  if (who.verdict === "own") return { action: "proceed", url, addIdentity: null };

  if (who.verdict === "third_party") {
    return {
      action: "refuse",
      message: `This looks like ${who.name}'s page, not ${input.clientName}'s. The knowledge base only takes ${input.clientName}'s own pages. Track it as a competitor source instead, so it stays public data.`,
      refusal: { url, ownerName: who.name, suggestion: null },
    };
  }
  if (!who.suggestion) {
    return {
      action: "refuse",
      message: "That page doesn't show whose it is (a feed, search or share link). Paste the company's own page instead.",
      refusal: { url, ownerName: null, suggestion: null },
    };
  }
  if (input.confirmOwn) return { action: "proceed", url, addIdentity: who.suggestion };
  return {
    action: "refuse",
    message: `${describeIdentity(who.suggestion)} isn't on ${input.clientName}'s list of own sites and pages. If it is, tick "Belongs to ${input.clientName}" and ingest again. If it belongs to anyone else, track it as a competitor or market source instead.`,
    refusal: { url, ownerName: null, suggestion: who.suggestion },
  };
}
