import { describe, expect, it } from "vitest";
import { activityForTicketQuery } from "./ticket-activity";

describe("activityForTicketQuery (workspace + ticket isolation)", () => {
  it("is scoped to workspace AND ticket", () => {
    const { sql, params } = activityForTicketQuery(
      "ws_1",
      "ticket_1",
    ).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"ticket_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("ticket_1");
  });

  it("orders by created_at descending with a 100 row limit", () => {
    const { sql } = activityForTicketQuery("ws_1", "ticket_1").toSQL();
    expect(sql).toMatch(/order by .*"created_at" desc/i);
    expect(sql).toMatch(/limit \$?\d/i);
  });
});
