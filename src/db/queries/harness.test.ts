import { describe, expect, it } from "vitest";
import {
  existingExternalIdsQuery,
  harnessRuleQuery,
  patternRunsQuery,
  recentProfileSnapshotsQuery,
  topPatternPostsQuery,
} from "./harness";

const WS = "ws_isolation_test";

describe("harness queries (workspace isolation)", () => {
  it("harness rule lookup is workspace-scoped", () => {
    const { sql, params } = harnessRuleQuery(WS).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain(WS);
  });

  it("pattern run history is workspace-scoped", () => {
    const { sql, params } = patternRunsQuery(WS).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain(WS);
  });

  it("top performers query is workspace-scoped", () => {
    const { sql, params } = topPatternPostsQuery(WS).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain(WS);
  });

  it("external-id dedupe lookup is workspace-scoped", () => {
    const { sql, params } = existingExternalIdsQuery(WS, ["x1", "x2"]).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain(WS);
    expect(params).toContain("x1");
  });

  it("recent profile snapshots query is workspace-scoped, ordered handle asc/takenAt desc, limited", () => {
    const { sql, params } = recentProfileSnapshotsQuery(WS, 200).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('order by');
    expect(sql.toLowerCase()).toContain('"handle" asc');
    expect(sql.toLowerCase()).toContain('"taken_at" desc');
    expect(sql).toContain('limit');
    expect(params).toContain(WS);
    expect(params).toContain(200);
  });
});
