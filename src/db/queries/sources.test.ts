import { describe, expect, it } from "vitest";
import {
  accountsForClientQuery,
  importJobsForClientQuery,
  patternPostCountQuery,
} from "./sources";

const WS = "ws_isolation_test";
const CLIENT = "client_1";

describe("source registry queries (workspace isolation)", () => {
  it("import jobs are scoped to workspace AND client", () => {
    const { sql, params } = importJobsForClientQuery(WS, CLIENT).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"client_id" =');
    expect(params).toContain(WS);
    expect(params).toContain(CLIENT);
  });

  it("connected accounts are scoped to workspace AND client", () => {
    const { sql, params } = accountsForClientQuery(WS, CLIENT).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"client_id" =');
    expect(params).toContain(WS);
  });

  it("pattern post count is scoped to workspace", () => {
    const { sql, params } = patternPostCountQuery(WS).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain(WS);
  });
});
