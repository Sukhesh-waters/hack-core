import { describe, expect, it } from "vitest";
import {
  advanceTicketStatusQuery,
  assignTicketQuery,
  deleteTicketQuery,
  ticketsQuery,
  updateTicketFieldsQuery,
} from "./tickets";

describe("ticketsQuery", () => {
  it("is workspace-scoped (isolation rule)", () => {
    const { sql, params } = ticketsQuery("ws_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("optionally filters by status", () => {
    const { sql, params } = ticketsQuery("ws_1", { status: "open" }).toSQL();
    expect(sql).toContain('"status" =');
    expect(params).toContain("open");
  });

  it("optionally filters by assigneeId", () => {
    const { sql, params } = ticketsQuery("ws_1", {
      assigneeId: "user_1",
    }).toSQL();
    expect(sql).toContain('"assignee_id" =');
    expect(params).toContain("user_1");
  });

  it("optionally filters by label (T3)", () => {
    const { sql, params } = ticketsQuery("ws_1", {
      label: "urgent",
    }).toSQL();
    expect(sql).toMatch(/= any\(/i);
    expect(params).toContain("urgent");
  });

  /**
   * T5: sub-task listing reuses ticketsQuery's opts pattern rather than a
   * separate childTicketsQuery. Both workspace_id AND parent_ticket_id must
   * appear in the WHERE — this is the query-layer half of the isolation
   * guard (the create-time guard is tested in actions.test.ts).
   */
  it("optionally filters by parentTicketId (T5)", () => {
    const { sql, params } = ticketsQuery("ws_1", {
      parentTicketId: "ticket_parent",
    }).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"parent_ticket_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("ticket_parent");
  });

  it("omits status/assignee/label/parentTicketId predicates when not provided", () => {
    const { params } = ticketsQuery("ws_1").toSQL();
    expect(params).toEqual(["ws_1"]);
  });

  /**
   * F9.5: client detail page filter. Both workspace_id AND client_id must
   * appear in the WHERE — isolation-critical for "tickets belonging to this
   * client," since client_id alone would leak another workspace's tickets
   * for a client id that happens to collide (or, more realistically, would
   * simply not be workspace-defensive as a query contract).
   */
  it("optionally filters by clientId (F9.5), scoped to workspace AND client", () => {
    const { sql, params } = ticketsQuery("ws_1", {
      clientId: "client_1",
    }).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"client_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("client_1");
  });
});

/**
 * Race guard: advanceTicketStatusQuery's WHERE must require status=from so a
 * second concurrent transition matches 0 rows and loses instead of both
 * winning (advanceTicketStatus checks the returned row count).
 */
describe("advanceTicketStatusQuery (race guard)", () => {
  const { sql, params } = advanceTicketStatusQuery({
    workspaceId: "ws_1",
    ticketId: "ticket_1",
    from: "open",
    to: "in_progress",
  }).toSQL();

  it("is scoped to workspace AND ticket id", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("ticket_1");
  });

  it("guards on the stale `from` status", () => {
    expect(sql).toContain('"status" =');
    expect(params).toContain("open");
  });

  it("sets the target status", () => {
    expect(params).toContain("in_progress");
  });

  it("returns the updated id so the caller can detect a lost race", () => {
    expect(sql).toContain("returning");
  });
});

describe("assignTicketQuery", () => {
  it("is scoped to workspace AND ticket id, and sets assigneeId", () => {
    const { sql, params } = assignTicketQuery(
      "ws_1",
      "ticket_1",
      "user_2",
    ).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(sql).toContain("returning");
    expect(params).toContain("ws_1");
    expect(params).toContain("ticket_1");
    expect(params).toContain("user_2");
  });

  it("allows unassigning with null", () => {
    const { sql, params } = assignTicketQuery("ws_1", "ticket_1", null).toSQL();
    expect(sql).toContain('"assignee_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("ticket_1");
    expect(params).toContain(null);
  });
});

describe("updateTicketFieldsQuery", () => {
  it("is workspace-and-id scoped", () => {
    const { sql, params } = updateTicketFieldsQuery("ws_1", "ticket_1", {
      title: "New title",
    }).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("ticket_1");
    expect(params).toContain("New title");
  });

  it("accepts a labels array update (T3)", () => {
    const { sql, params } = updateTicketFieldsQuery("ws_1", "ticket_1", {
      labels: ["urgent", "client-facing"],
    }).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"labels" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("ticket_1");
  });
});

/**
 * T4: hard delete, gated to owner-only at the action layer
 * (ticket-permissions.ts). Cascades to ticket_comments/ticket_activity via
 * their existing FK cascade — no manual cleanup needed here.
 */
describe("deleteTicketQuery", () => {
  it("is scoped to workspace AND ticket id", () => {
    const { sql, params } = deleteTicketQuery("ws_1", "ticket_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("ticket_1");
  });

  it("returns the deleted id so the caller can detect a not-found", () => {
    const { sql } = deleteTicketQuery("ws_1", "ticket_1").toSQL();
    expect(sql).toContain("returning");
  });
});
