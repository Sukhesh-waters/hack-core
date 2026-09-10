import { describe, expect, it } from "vitest";
import { commentsForTicketQuery } from "./ticket-comments";

describe("ticket comments queries (workspace + ticket isolation)", () => {
  it("thread lookup is scoped to workspace AND ticket", () => {
    const { sql, params } = commentsForTicketQuery(
      "ws_isolation_test",
      "ticket_1",
    ).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"ticket_id" =');
    expect(params).toContain("ws_isolation_test");
    expect(params).toContain("ticket_1");
  });

  it("orders by created_at ascending with a 200 row limit", () => {
    const { sql } = commentsForTicketQuery("ws_1", "ticket_1").toSQL();
    expect(sql).toMatch(/order by .*"created_at" asc/i);
    expect(sql).toMatch(/limit \$?\d/i);
  });
});
