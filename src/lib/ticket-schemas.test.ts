import { describe, expect, it } from "vitest";
import {
  addTicketCommentSchema,
  advanceTicketStatusSchema,
  assignTicketSchema,
  createTicketSchema,
  updateTicketSchema,
} from "./ticket-schemas";

describe("createTicketSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = createTicketSchema.safeParse({
      workspaceId: "ws_1",
      title: "Fix the thing",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe("medium");
    }
  });

  it("accepts a full valid payload", () => {
    const result = createTicketSchema.safeParse({
      workspaceId: "ws_1",
      title: "Fix the thing",
      description: "Some detail",
      priority: "high",
      assigneeId: "user_1",
      dueAt: "2026-08-01",
      linkedType: "content",
      linkedId: "content_1",
    });
    expect(result.success).toBe(true);
  });

  it("treats empty-string optional fields as absent, not invalid — the real shape a native <select>'s unselected/default option submits via FormData", () => {
    // Regression: optionalId's .min(1) used to run before its
    // empty-to-undefined transform, so "" failed validation instead of
    // being dropped — this is exactly what the browser sends for
    // <option value="">Unassigned</option> / "No client" / "No link",
    // which no prior test exercised (they only tested omitting the key
    // entirely, which is a different shape than a real form submission).
    const result = createTicketSchema.safeParse({
      workspaceId: "ws_1",
      title: "Fix the thing",
      description: "",
      assigneeId: "",
      dueAt: "",
      linkedType: "",
      linkedId: "",
      parentTicketId: "",
      clientId: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assigneeId).toBeUndefined();
      expect(result.data.linkedType).toBeUndefined();
      expect(result.data.linkedId).toBeUndefined();
      expect(result.data.parentTicketId).toBeUndefined();
      expect(result.data.clientId).toBeUndefined();
      expect(result.data.description).toBeUndefined();
    }
  });

  it("treats fields absent from FormData entirely (JS null, not empty string) as absent too — the shape add-subtask-form.tsx submits, which only ever renders title/workspaceId/parentTicketId", () => {
    // Regression: FormData.get() returns null (not "" or undefined) for a
    // key that was never rendered as an <input> at all. z.optional() and
    // z.default() only short-circuit for a literal `undefined` — a null
    // fails .string()'s base type check (or the enum check) before ever
    // reaching a .transform()/.default(). Caught live: creating a
    // sub-task (title-only form, every other field genuinely absent from
    // the DOM) failed with the same "Invalid input" error the "" case did,
    // even after that fix — description/priority/dueAt/linkedType all
    // independently needed the same null-tolerant preprocess.
    const result = createTicketSchema.safeParse({
      workspaceId: "ws_1",
      title: "Draft the exact quote request email",
      description: null,
      priority: null,
      assigneeId: null,
      dueAt: null,
      linkedType: null,
      linkedId: null,
      parentTicketId: "ticket_1",
      clientId: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe("medium");
      expect(result.data.description).toBeUndefined();
      expect(result.data.assigneeId).toBeUndefined();
      expect(result.data.dueAt).toBeUndefined();
      expect(result.data.linkedType).toBeUndefined();
      expect(result.data.linkedId).toBeUndefined();
      expect(result.data.clientId).toBeUndefined();
      expect(result.data.parentTicketId).toBe("ticket_1");
    }
  });

  it("rejects a missing title", () => {
    const result = createTicketSchema.safeParse({
      workspaceId: "ws_1",
      title: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid priority enum", () => {
    const result = createTicketSchema.safeParse({
      workspaceId: "ws_1",
      title: "Fix the thing",
      priority: "urgent",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid dueAt", () => {
    const result = createTicketSchema.safeParse({
      workspaceId: "ws_1",
      title: "Fix the thing",
      dueAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects linkedType without linkedId", () => {
    const result = createTicketSchema.safeParse({
      workspaceId: "ws_1",
      title: "Fix the thing",
      linkedType: "idea",
    });
    expect(result.success).toBe(false);
  });

  it("rejects linkedId without linkedType", () => {
    const result = createTicketSchema.safeParse({
      workspaceId: "ws_1",
      title: "Fix the thing",
      linkedId: "idea_1",
    });
    expect(result.success).toBe(false);
  });
});

describe("advanceTicketStatusSchema", () => {
  it("accepts a valid payload", () => {
    const result = advanceTicketStatusSchema.safeParse({
      workspaceId: "ws_1",
      ticketId: "ticket_1",
      from: "open",
      to: "in_progress",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid status enum", () => {
    const result = advanceTicketStatusSchema.safeParse({
      workspaceId: "ws_1",
      ticketId: "ticket_1",
      from: "open",
      to: "closed",
    });
    expect(result.success).toBe(false);
  });
});

describe("assignTicketSchema", () => {
  it("accepts an assigneeId", () => {
    const result = assignTicketSchema.safeParse({
      workspaceId: "ws_1",
      ticketId: "ticket_1",
      assigneeId: "user_1",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an absent assigneeId (unassign)", () => {
    const result = assignTicketSchema.safeParse({
      workspaceId: "ws_1",
      ticketId: "ticket_1",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assigneeId).toBeUndefined();
    }
  });
});

describe("addTicketCommentSchema", () => {
  it("accepts a valid body", () => {
    const result = addTicketCommentSchema.safeParse({
      workspaceId: "ws_1",
      ticketId: "ticket_1",
      body: "Looks good, shipping this.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty body", () => {
    const result = addTicketCommentSchema.safeParse({
      workspaceId: "ws_1",
      ticketId: "ticket_1",
      body: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a whitespace-only body", () => {
    const result = addTicketCommentSchema.safeParse({
      workspaceId: "ws_1",
      ticketId: "ticket_1",
      body: "   \n\t  ",
    });
    expect(result.success).toBe(false);
  });

  it("trims surrounding whitespace on an otherwise valid body", () => {
    const result = addTicketCommentSchema.safeParse({
      workspaceId: "ws_1",
      ticketId: "ticket_1",
      body: "  hello  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.body).toBe("hello");
    }
  });
});

describe("updateTicketSchema", () => {
  it("round-trips a valid payload", () => {
    const result = updateTicketSchema.safeParse({
      workspaceId: "ws_1",
      ticketId: "ticket_1",
      title: "Updated title",
      priority: "low",
      dueAt: "2026-09-01",
    });
    expect(result.success).toBe(true);
  });

  it("treats empty-string optional fields as absent, not invalid (same regression as createTicketSchema)", () => {
    const result = updateTicketSchema.safeParse({
      workspaceId: "ws_1",
      ticketId: "ticket_1",
      title: "Updated title",
      description: "",
      priority: "medium",
      dueAt: "",
      linkedType: "",
      linkedId: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.linkedType).toBeUndefined();
      expect(result.data.linkedId).toBeUndefined();
    }
  });

  it("rejects a missing title", () => {
    const result = updateTicketSchema.safeParse({
      workspaceId: "ws_1",
      ticketId: "ticket_1",
      title: "",
      priority: "low",
    });
    expect(result.success).toBe(false);
  });

  it("rejects mismatched link fields", () => {
    const result = updateTicketSchema.safeParse({
      workspaceId: "ws_1",
      ticketId: "ticket_1",
      title: "Title",
      priority: "medium",
      linkedType: "campaign",
    });
    expect(result.success).toBe(false);
  });
});
