import { describe, expect, it } from "vitest";
import { planAttributionQuery } from "./plan-attribution";

const WS = "ws_attribution_test";

describe("planAttributionQuery (workspace isolation & filters)", () => {
  it("scopes to workspace_id", () => {
    const { sql, params } = planAttributionQuery(WS).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain(WS);
  });

  it("applies range filters when provided", () => {
    const from = new Date("2026-08-01");
    const to = new Date("2026-09-01");
    const { sql, params } = planAttributionQuery(WS, { from, to }).toSQL();
    expect(sql).toContain('"scheduled_for" >=');
    expect(sql).toContain('"scheduled_for" <');
    expect(params).toContain(from.toISOString());
    expect(params).toContain(to.toISOString());
  });

  it("filters by clientId when provided", () => {
    const { sql, params } = planAttributionQuery(WS, undefined, "cli_123").toSQL();
    expect(sql).toContain('"client_id" =');
    expect(params).toContain("cli_123");
  });
});
