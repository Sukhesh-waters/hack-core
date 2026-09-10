import { describe, expect, it } from "vitest";
import {
  listDueReportSchedulesQuery,
  listReportSchedulesQuery,
} from "./report-schedules";

const WS = "ws_reports_test";

describe("reportSchedules queries (workspace isolation)", () => {
  it("listReportSchedulesQuery scopes WHERE to workspace_id", () => {
    const { sql, params } = listReportSchedulesQuery(WS).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain(WS);
  });

  it("listDueReportSchedulesQuery selects schedules where last_sent_at is null or before cutoff", () => {
    const cutoff = new Date("2026-08-01T00:00:00Z");
    const { sql, params } = listDueReportSchedulesQuery(cutoff).toSQL();
    expect(sql.toLowerCase()).toContain("last_sent_at");
    expect(params).toContain(cutoff.toISOString());
  });
});
