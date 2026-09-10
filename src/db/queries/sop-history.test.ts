import { describe, expect, it } from "vitest";
import {
  sopTemplateRunCountsQuery,
  templateRunsQuery,
  templateRunStepsQuery,
} from "./sop-history";

const WS = "ws_sop_test";
const TEMPLATE_ID = "tmpl_alpha";

describe("templateRunsQuery (workspace isolation & filters)", () => {
  it("scopes strictly to workspace_id and template_id", () => {
    const { sql, params } = templateRunsQuery(WS, TEMPLATE_ID).toSQL();
    expect(sql).toContain('"sop_runs"."workspace_id" =');
    expect(sql).toContain('"sop_runs"."template_id" =');
    expect(params).toContain(WS);
    expect(params).toContain(TEMPLATE_ID);
  });

  it("joins clients and users for run metadata", () => {
    const { sql } = templateRunsQuery(WS, TEMPLATE_ID).toSQL();
    expect(sql).toContain('left join "clients"');
    expect(sql).toContain('left join "users"');
  });
});

describe("templateRunStepsQuery (workspace isolation & run IDs)", () => {
  it("scopes to workspace_id and checks inArray run_id", () => {
    const runIds = ["run_1", "run_2"];
    const { sql, params } = templateRunStepsQuery(WS, runIds).toSQL();
    expect(sql).toContain('"sop_run_steps"."workspace_id" =');
    expect(sql).toContain('"sop_run_steps"."run_id" in');
    expect(params).toContain(WS);
    expect(params).toContain("run_1");
    expect(params).toContain("run_2");
  });

  it("handles empty runIds gracefully without throwing", () => {
    const { sql } = templateRunStepsQuery(WS, []).toSQL();
    expect(sql).toContain('"sop_run_steps"."workspace_id" =');
    expect(sql).toContain('"sop_run_steps"."run_id" in');
  });
});

describe("sopTemplateRunCountsQuery (workspace isolation & grouping)", () => {
  it("scopes to workspace_id and groups by template_id", () => {
    const { sql, params } = sopTemplateRunCountsQuery(WS).toSQL();
    expect(sql).toContain('"sop_runs"."workspace_id" =');
    expect(sql).toContain('"sop_runs"."template_id" is not null');
    expect(sql).toContain('group by "sop_runs"."template_id"');
    expect(params).toContain(WS);
  });
});
