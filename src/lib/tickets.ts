import { ticketStatus } from "@/db/schema";

export type TicketStatus = (typeof ticketStatus.enumValues)[number];

// ---------------------------------------------------------------------------
// F9.3: ticket link resolution. Turns (linkedType, linkedId, resolvedObject)
// into a render-ready {href, label} pair, or null if there's nothing to show
// (no link set) — kept pure and separate from the DB lookups so the mapping
// itself is directly unit-testable without touching a database.
// ---------------------------------------------------------------------------

export type TicketLinkType = "content" | "idea" | "campaign" | "client";

/** Minimal shape each resolved linked object needs to supply — the query
 *  layer maps its real row into this before calling resolveTicketLink. */
export type ResolvedLinkedObject = { id: string; label: string };

export type TicketLinkView =
  | { href: string; label: string; clickable: true }
  | { label: string; clickable: false }
  | { missing: true };

/**
 * Pure mapping used by the ticket detail page to render a resolved,
 * clickable link for tickets.linkedType/linkedId. `resolved` is whatever the
 * matching get-by-id query returned (already workspace-scoped), mapped down
 * to {id, label} — or null if the row no longer exists (deleted) or if
 * linkedType/linkedId weren't set at all.
 *
 * - content -> Studio page for that draft
 * - idea -> Plan (no per-idea detail page exists yet)
 * - campaign -> Ads page (no per-campaign detail page exists yet)
 * - client -> clients list, non-clickable-equivalent target until a client
 *   detail page ships (F9.5) — still returns a real href so the caller can
 *   choose to render it as a link; resolved name is never a raw id either way.
 */
export function resolveTicketLink(
  workspaceId: string,
  linkedType: TicketLinkType | null,
  linkedId: string | null,
  resolved: ResolvedLinkedObject | null,
): TicketLinkView | null {
  if (!linkedType || !linkedId) return null;
  if (!resolved) return { missing: true };

  switch (linkedType) {
    case "content":
      return {
        href: `/w/${workspaceId}/studio/${resolved.id}`,
        label: resolved.label,
        clickable: true,
      };
    case "idea":
      return {
        href: `/w/${workspaceId}/plan`,
        label: resolved.label,
        clickable: true,
      };
    case "campaign":
      return {
        href: `/w/${workspaceId}/ads`,
        label: resolved.label,
        clickable: true,
      };
    case "client":
      return {
        href: `/w/${workspaceId}/clients`,
        label: resolved.label,
        clickable: true,
      };
    default: {
      const _exhaustive: never = linkedType;
      return _exhaustive;
    }
  }
}

/** Single source of truth for column order — derived from the pgEnum. */
export const TICKET_STATUS_ORDER = ticketStatus.enumValues;

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

export type TicketTransition = {
  to: TicketStatus;
  label: string;
};

/**
 * Not a straight line: in_progress has three exits (block, mark done, or
 * reopen back to open); blocked can unblock forward or close directly;
 * done's only exit is reopen. Mirrors src/lib/production.ts's shape, own
 * graph — production's transitions are content-specific.
 */
const TRANSITIONS: Record<TicketStatus, TicketTransition[]> = {
  open: [
    { to: "in_progress", label: "Start" },
    { to: "done", label: "Close" },
  ],
  in_progress: [
    { to: "blocked", label: "Block" },
    { to: "done", label: "Mark done" },
    { to: "open", label: "Reopen" },
  ],
  blocked: [
    { to: "in_progress", label: "Unblock" },
    { to: "done", label: "Mark done" },
  ],
  done: [{ to: "open", label: "Reopen" }],
};

export function transitionsFor(status: TicketStatus): TicketTransition[] {
  return TRANSITIONS[status];
}

export function isValidTransition(
  from: TicketStatus,
  to: TicketStatus,
): boolean {
  return TRANSITIONS[from].some((t) => t.to === to);
}

/** Mirrors calendar's isOverdueSlot: a ticket is overdue once its due date
 *  has passed and it hasn't reached the terminal "done" status. */
export function isOverdueTicket(
  dueAt: Date | null,
  status: TicketStatus,
  now: Date = new Date(),
): boolean {
  if (!dueAt) return false;
  return dueAt.getTime() < now.getTime() && status !== "done";
}

/**
 * T5 isolation guard, pure half. `getTicket(workspaceId, parentTicketId)` is
 * already workspace-scoped in its WHERE, so a lookup for a parent ticket
 * that exists but belongs to ANOTHER workspace returns null — same as a
 * parent that doesn't exist at all. This function turns that lookup result
 * into a pass/throw decision, kept separate from the DB call itself so the
 * decision is directly unit-testable without a database (this repo's
 * "no DB integration tests" idiom) — the caller (createTicketAction) does
 * `assertParentInSameWorkspace(await getTicket(workspaceId, parentTicketId))`.
 */
export function assertParentInSameWorkspace(
  parent: { id: string; workspaceId: string } | null,
): void {
  if (!parent) {
    throw new Error("Parent ticket not found in this workspace.");
  }
}

/**
 * F9.3 isolation guard, pure half — mirrors assertParentInSameWorkspace. The
 * action layer resolves `linkedId` via the matching workspace-scoped
 * get-by-id query for `linkedType` (getContentById/getIdea/getCampaignById/
 * getClientById) and passes the result here. A null result means the row
 * either doesn't exist at all or belongs to a DIFFERENT workspace (each
 * lookup's own WHERE already collapses both cases to null) — either way, a
 * ticket must not be allowed to link to it.
 */
export function assertLinkedObjectInWorkspace(
  resolved: { id: string } | null,
): void {
  if (!resolved) {
    throw new Error("Linked item not found in this workspace.");
  }
}

/**
 * F9.5 isolation guard, pure half — mirrors assertParentInSameWorkspace and
 * assertLinkedObjectInWorkspace. `getClientById(workspaceId, clientId)` is
 * already workspace-scoped in its WHERE, so a lookup for a client that
 * exists but belongs to ANOTHER workspace returns null — same as a client
 * that doesn't exist at all. Kept separate from the DB call so the pass/
 * throw decision is directly unit-testable without a database.
 */
export function assertClientInSameWorkspace(
  client: { id: string } | null,
): void {
  if (!client) {
    throw new Error("That client is not in this workspace.");
  }
}

export type MentionableMember = { userId: string; name: string | null };

/** Escape a string for embedding inside a RegExp source. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pure @mention parser for T3. Matches `@name` tokens in a comment body
 * against known workspace member names — first-name or full-name,
 * case-insensitive, word-boundary only (so "@name" inside an email like
 * "foo@name.com" or a URL never matches). No fuzzy matching: an exact
 * (case-insensitive) match against a member's first name or full name is
 * required. Returns deduped userIds, in first-mention order.
 */
export function extractMentions(
  body: string,
  members: MentionableMember[],
): string[] {
  if (!body) return [];

  // Build a lookup of lowercase name -> userId, both full name and first
  // name, for every member that actually has a name set.
  const nameToUserId = new Map<string, string>();
  for (const member of members) {
    if (!member.name) continue;
    const trimmed = member.name.trim();
    if (!trimmed) continue;
    const full = trimmed.toLowerCase();
    const first = trimmed.split(/\s+/)[0]!.toLowerCase();
    // Don't let a later member silently overwrite an earlier same-name
    // match — first match wins, consistent with "keep it simple".
    if (!nameToUserId.has(full)) nameToUserId.set(full, member.userId);
    if (!nameToUserId.has(first)) nameToUserId.set(first, member.userId);
  }
  if (nameToUserId.size === 0) return [];

  // Longest names first so "@jane doe" matches the full name before the
  // shorter "@jane" alternative would otherwise win.
  const candidates = [...nameToUserId.keys()].sort((a, b) => b.length - a.length);
  const pattern = candidates.map(escapeRegExp).join("|");
  // (?<![\w.@/-]) blocks matches where the "@" is preceded by a word char,
  // dot, "@", slash, or "-" — i.e. inside an email local-part
  // ("foo@name.com"), an email domain ("foo.bar@jane.com"), or a URL path
  // segment ("example.com/@jane") — so none of those ever match. The
  // mention itself still requires a leading "@" followed by a known name,
  // then a word boundary so "@janedoe2" doesn't match "@jane".
  const mentionRe = new RegExp(
    `(?<![\\w.@/-])@(${pattern})\\b`,
    "gi",
  );

  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of body.matchAll(mentionRe)) {
    const matchedName = match[1]!.toLowerCase();
    const userId = nameToUserId.get(matchedName);
    if (!userId) continue;
    if (seen.has(userId)) continue;
    seen.add(userId);
    result.push(userId);
  }
  return result;
}
