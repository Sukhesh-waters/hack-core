import { describe, expect, it } from "vitest";
import {
  assertClientInSameWorkspace,
  assertLinkedObjectInWorkspace,
  assertParentInSameWorkspace,
  extractMentions,
  isOverdueTicket,
  isValidTransition,
  resolveTicketLink,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_ORDER,
  transitionsFor,
  type TicketLinkType,
  type TicketStatus,
} from "./tickets";

describe("TICKET_STATUS_ORDER / TICKET_STATUS_LABELS", () => {
  it("every enum value has a label", () => {
    for (const status of TICKET_STATUS_ORDER) {
      expect(TICKET_STATUS_LABELS[status]).toBeDefined();
    }
  });

  it("matches the expected four statuses", () => {
    expect(TICKET_STATUS_ORDER).toEqual([
      "open",
      "in_progress",
      "blocked",
      "done",
    ]);
  });
});

describe("transitionsFor / isValidTransition", () => {
  it("every enum value has a TRANSITIONS entry (possibly empty)", () => {
    for (const status of TICKET_STATUS_ORDER) {
      expect(transitionsFor(status)).toBeDefined();
    }
  });

  const table: {
    from: TicketStatus;
    valid: TicketStatus[];
    invalid: TicketStatus[];
  }[] = [
    { from: "open", valid: ["in_progress", "done"], invalid: ["blocked", "open"] },
    {
      from: "in_progress",
      valid: ["blocked", "done", "open"],
      invalid: ["in_progress"],
    },
    {
      from: "blocked",
      valid: ["in_progress", "done"],
      invalid: ["open", "blocked"],
    },
    { from: "done", valid: ["open"], invalid: ["in_progress", "blocked", "done"] },
  ];

  it.each(table)("valid/invalid transitions from $from", ({ from, valid, invalid }) => {
    for (const to of valid) {
      expect(isValidTransition(from, to)).toBe(true);
    }
    for (const to of invalid) {
      expect(isValidTransition(from, to)).toBe(false);
    }
  });

  it("done is not a dead end — it can reopen", () => {
    expect(transitionsFor("done")).toEqual([{ to: "open", label: "Reopen" }]);
  });
});

describe("isOverdueTicket", () => {
  const now = new Date("2026-07-20T12:00:00Z");

  it("is false when dueAt is null", () => {
    expect(isOverdueTicket(null, "open", now)).toBe(false);
  });

  it("is true when dueAt is in the past and status is not done", () => {
    const past = new Date("2026-07-19T12:00:00Z");
    expect(isOverdueTicket(past, "open", now)).toBe(true);
    expect(isOverdueTicket(past, "in_progress", now)).toBe(true);
    expect(isOverdueTicket(past, "blocked", now)).toBe(true);
  });

  it("is false when dueAt is in the past but status is done", () => {
    const past = new Date("2026-07-19T12:00:00Z");
    expect(isOverdueTicket(past, "done", now)).toBe(false);
  });

  it("is false when dueAt is in the future", () => {
    const future = new Date("2026-07-21T12:00:00Z");
    expect(isOverdueTicket(future, "open", now)).toBe(false);
  });

  it("is false exactly at the boundary (dueAt === now)", () => {
    expect(isOverdueTicket(now, "open", now)).toBe(false);
  });
});

describe("extractMentions", () => {
  const members = [
    { userId: "u_sukhesh", name: "Sukhesh Kanna" },
    { userId: "u_jane", name: "Jane Doe" },
    { userId: "u_bob", name: "Bob" },
    { userId: "u_noname", name: null },
  ];

  it("returns [] for an empty body", () => {
    expect(extractMentions("", members)).toEqual([]);
  });

  it("returns [] when there are no @ tokens at all", () => {
    expect(extractMentions("no mentions here", members)).toEqual([]);
  });

  it("returns [] when no member roster is provided", () => {
    expect(extractMentions("@sukhesh please look", [])).toEqual([]);
  });

  it("matches a first-name mention", () => {
    expect(extractMentions("@sukhesh can you check this?", members)).toEqual([
      "u_sukhesh",
    ]);
  });

  it("matches a full-name mention (first + last)", () => {
    expect(extractMentions("@jane doe please review", members)).toEqual([
      "u_jane",
    ]);
  });

  it("matches a single-word name", () => {
    expect(extractMentions("ping @bob about this", members)).toEqual([
      "u_bob",
    ]);
  });

  it("is case-insensitive", () => {
    expect(extractMentions("@SUKHESH @Jane please review", members)).toEqual([
      "u_sukhesh",
      "u_jane",
    ]);
  });

  it("matches multiple distinct mentions in one body, in order", () => {
    expect(
      extractMentions("@bob then @sukhesh then @jane", members),
    ).toEqual(["u_bob", "u_sukhesh", "u_jane"]);
  });

  it("dedupes repeated mentions of the same user in one comment", () => {
    expect(
      extractMentions("@sukhesh please check, cc @sukhesh again", members),
    ).toEqual(["u_sukhesh"]);
  });

  it("dedupes when both first-name and full-name forms mention the same user", () => {
    expect(extractMentions("@sukhesh and also @sukhesh kanna", members)).toEqual([
      "u_sukhesh",
    ]);
  });

  it("respects word boundaries — a longer token is not a match", () => {
    expect(extractMentions("@janedoe2 is not jane", members)).toEqual([]);
  });

  it("ignores an @ inside an email address (local-part)", () => {
    expect(
      extractMentions("contact me at sukhesh@name.com please", members),
    ).toEqual([]);
  });

  it("ignores an @ inside an email address whose local-part contains a dot", () => {
    expect(extractMentions("email test: foo.bar@jane.com", members)).toEqual(
      [],
    );
  });

  it("ignores an @ inside a URL path segment", () => {
    expect(
      extractMentions("visit www.example.com/@jane for info", members),
    ).toEqual([]);
  });

  it("still matches a mention immediately followed by punctuation", () => {
    expect(extractMentions("@jane's work is great", members)).toEqual([
      "u_jane",
    ]);
  });

  it("ignores members with no name set", () => {
    expect(extractMentions("@noname should not match anything", members)).toEqual(
      [],
    );
  });

  it("no match for an unknown name", () => {
    expect(extractMentions("@someoneelse please check", members)).toEqual([]);
  });
});

/**
 * T5 isolation-critical test: assertParentInSameWorkspace is the pure half
 * of the create-time guard that prevents a sub-task from silently attaching
 * to a parent ticket in a DIFFERENT workspace (or one that doesn't exist at
 * all). The action layer calls
 * `assertParentInSameWorkspace(await getTicket(workspaceId, parentTicketId))`
 * — since getTicket's own WHERE is already workspace-scoped, a parent that
 * exists but belongs to another workspace comes back as null, which this
 * function must reject exactly like a nonexistent parent.
 */
describe("assertParentInSameWorkspace (T5 cross-workspace guard)", () => {
  it("passes silently when the parent lookup found a ticket", () => {
    expect(() =>
      assertParentInSameWorkspace({ id: "ticket_1", workspaceId: "ws_1" }),
    ).not.toThrow();
  });

  it("throws when the parent lookup returned null — covers BOTH a nonexistent parentTicketId AND a parentTicketId that belongs to a different workspace (getTicket's workspace-scoped WHERE already collapses both cases to null)", () => {
    expect(() => assertParentInSameWorkspace(null)).toThrow(
      /parent ticket not found in this workspace/i,
    );
  });
});

/**
 * F9.3 isolation-critical test: assertLinkedObjectInWorkspace is the pure
 * half of the create/update-time guard preventing a ticket from linking to
 * an object (content/idea/campaign/client) that belongs to a DIFFERENT
 * workspace or doesn't exist at all — same shape as
 * assertParentInSameWorkspace above.
 */
describe("assertLinkedObjectInWorkspace (F9.3 cross-workspace guard)", () => {
  it("passes silently when the lookup found a row", () => {
    expect(() =>
      assertLinkedObjectInWorkspace({ id: "content_1" }),
    ).not.toThrow();
  });

  it("throws when the lookup returned null — covers BOTH a nonexistent linkedId AND a linkedId that belongs to a different workspace", () => {
    expect(() => assertLinkedObjectInWorkspace(null)).toThrow(
      /linked item not found in this workspace/i,
    );
  });
});

/**
 * F9.5 isolation-critical test: assertClientInSameWorkspace is the pure half
 * of the create-time guard preventing a ticket's clientId from silently
 * attaching to a client in a DIFFERENT workspace (or one that doesn't exist
 * at all) — same shape as assertParentInSameWorkspace and
 * assertLinkedObjectInWorkspace above.
 */
describe("assertClientInSameWorkspace (F9.5 cross-workspace guard)", () => {
  it("passes silently when the client lookup found a row", () => {
    expect(() =>
      assertClientInSameWorkspace({ id: "client_1" }),
    ).not.toThrow();
  });

  it("throws when the client lookup returned null — covers BOTH a nonexistent clientId AND a clientId that belongs to a different workspace", () => {
    expect(() => assertClientInSameWorkspace(null)).toThrow(
      /that client is not in this workspace/i,
    );
  });
});

/**
 * F9.3: resolveTicketLink is the pure mapping the ticket detail page uses to
 * turn (linkedType, linkedId, resolvedObject) into a render-ready link (or a
 * "no longer available" state). Each of the 4 ticketLinkType values must
 * produce the correct href; a null resolved object (deleted row) must
 * produce the missing state, never a raw id or a crash.
 */
describe("resolveTicketLink", () => {
  const workspaceId = "ws_1";
  const resolved = { id: "obj_1", label: "My Object" };

  it("returns null when no link is set", () => {
    expect(resolveTicketLink(workspaceId, null, null, null)).toBeNull();
  });

  it("returns null when linkedType is set but linkedId is not (malformed both-or-neither)", () => {
    expect(resolveTicketLink(workspaceId, "content", null, resolved)).toBeNull();
  });

  it("returns the missing state when the resolved object is null (deleted)", () => {
    expect(resolveTicketLink(workspaceId, "content", "obj_1", null)).toEqual({
      missing: true,
    });
  });

  it("resolves content to a Studio link", () => {
    expect(resolveTicketLink(workspaceId, "content", "obj_1", resolved)).toEqual({
      href: "/w/ws_1/studio/obj_1",
      label: "My Object",
      clickable: true,
    });
  });

  it("resolves idea to the Plan page", () => {
    expect(resolveTicketLink(workspaceId, "idea", "obj_1", resolved)).toEqual({
      href: "/w/ws_1/plan",
      label: "My Object",
      clickable: true,
    });
  });

  it("resolves campaign to the Ads page", () => {
    expect(resolveTicketLink(workspaceId, "campaign", "obj_1", resolved)).toEqual({
      href: "/w/ws_1/ads",
      label: "My Object",
      clickable: true,
    });
  });

  it("resolves client to the clients list, with the real name never a raw id", () => {
    expect(resolveTicketLink(workspaceId, "client", "obj_1", resolved)).toEqual({
      href: "/w/ws_1/clients",
      label: "My Object",
      clickable: true,
    });
  });

  it("covers every ticketLinkType enum value", () => {
    const types: TicketLinkType[] = ["content", "idea", "campaign", "client"];
    for (const type of types) {
      const view = resolveTicketLink(workspaceId, type, "obj_1", resolved);
      expect(view && "href" in view ? view.href : null).not.toBeNull();
    }
  });
});
