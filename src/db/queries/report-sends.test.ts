import { describe, expect, it } from "vitest";
import { recentSendsQuery } from "./report-sends";

describe("recentSendsQuery (report send-log isolation)", () => {
  it("is scoped to workspace AND client id", () => {
    const { sql, params } = recentSendsQuery("ws_1", "client_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"client_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("client_1");
  });

  it("orders most recent send first", () => {
    const { sql } = recentSendsQuery("ws_1", "client_1").toSQL();
    expect(sql.toLowerCase()).toContain("order by");
    expect(sql.toLowerCase()).toContain("desc");
  });

  it("defaults the limit to 5 and respects an explicit limit", () => {
    const { sql: defaultSql, params: defaultParams } = recentSendsQuery(
      "ws_1",
      "client_1",
    ).toSQL();
    expect(defaultSql.toLowerCase()).toContain("limit");
    expect(defaultParams).toContain(5);

    const { params: customParams } = recentSendsQuery(
      "ws_1",
      "client_1",
      10,
    ).toSQL();
    expect(customParams).toContain(10);
  });
});
