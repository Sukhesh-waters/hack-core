import { describe, expect, it } from "vitest";
import {
  clientPerformanceQuery,
  engagementTrendQuery,
  formatPerformanceQuery,
  nextMonthScheduledQuery,
  workspaceTotalsQuery,
} from "./analytics";

describe("analytics queries (workspace isolation + two-layer rule)", () => {
  it("client rollup is workspace-scoped and first-party only", () => {
    const { sql, params } = clientPerformanceQuery("ws_isolation_test").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_isolation_test");
    expect(params).toContain("first_party");
  });

  it("format performance is workspace+client scoped and first-party only", () => {
    const { sql, params } = formatPerformanceQuery(
      "ws_isolation_test",
      "client_1",
    ).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"client_id" =');
    expect(params).toContain("ws_isolation_test");
    expect(params).toContain("first_party");
  });

  it("next-month scheduled count is workspace+client scoped and date-bounded", () => {
    const start = new Date("2026-08-01T00:00:00Z");
    const end = new Date("2026-09-01T00:00:00Z");
    const { sql, params } = nextMonthScheduledQuery(
      "ws_isolation_test",
      "client_1",
      start,
      end,
    ).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"scheduled_for" >=');
    expect(sql).toContain('"scheduled_for" <');
    expect(params).toContain(start.toISOString());
    expect(params).toContain(end.toISOString());
  });

  it("workspace totals are workspace-scoped and first-party only", () => {
    const { sql, params } = workspaceTotalsQuery("ws_isolation_test").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain("posts");
    expect(sql).not.toContain("pattern_posts");
    expect(params).toContain("ws_isolation_test");
    expect(params).toContain("first_party");
  });

  it("engagement trend is workspace-scoped, first-party only, and date-bounded", () => {
    const since = new Date("2026-01-01T00:00:00Z");
    const { sql, params } = engagementTrendQuery(
      "ws_isolation_test",
      since,
    ).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"posted_at" >=');
    expect(sql).toContain("date_trunc");
    expect(sql).not.toContain("pattern_posts");
    expect(params).toContain("ws_isolation_test");
    expect(params).toContain("first_party");
    expect(params).toContain(since.toISOString());
  });
});
