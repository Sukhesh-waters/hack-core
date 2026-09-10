import { describe, expect, it } from "vitest";
import {
  capAlertQuery,
  recentUsageQuery,
  spendByProviderQuery,
  workspaceSpendQuery,
} from "./usage";

const WS = "ws_isolation_test";
const SINCE = new Date("2026-07-08T00:00:00Z");

describe("ai usage queries (workspace isolation)", () => {
  it("spend rollup is workspace-scoped", () => {
    const { sql, params } = workspaceSpendQuery(WS, SINCE).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain(WS);
  });

  it("provider breakdown is workspace-scoped", () => {
    const { sql, params } = spendByProviderQuery(WS, SINCE).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql.toLowerCase()).toContain("group by");
    expect(params).toContain(WS);
  });

  it("recent usage is workspace-scoped", () => {
    const { sql, params } = recentUsageQuery(WS).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain(WS);
  });

  it("cap-alert lookup is workspace-scoped", () => {
    const { sql, params } = capAlertQuery(WS, SINCE).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("cap-alert");
  });
});
