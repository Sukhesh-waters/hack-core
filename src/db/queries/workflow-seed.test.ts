import { describe, expect, it } from "vitest";
import {
  initialStateQuery,
  workflowStatesQuery,
  workflowTransitionsQuery,
} from "./workflow-seed";

describe("workflowStatesQuery (W1)", () => {
  const { sql, params } = workflowStatesQuery("ws_1", "wf_1").toSQL();

  it("is scoped by workspace AND workflow (isolation rule)", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"workflow_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("wf_1");
  });

  it("returns board order, not insertion order", () => {
    expect(sql.toLowerCase()).toContain("order by");
    expect(sql).toContain('"position"');
  });

  it("is bounded", () => {
    expect(sql.toLowerCase()).toContain("limit");
  });
});

describe("workflowTransitionsQuery (W1)", () => {
  const { sql, params } = workflowTransitionsQuery("ws_1", "wf_1").toSQL();

  it("is scoped by workspace AND workflow", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"workflow_id" =');
    expect(params).toContain("ws_1");
  });

  it("is ordered and bounded", () => {
    expect(sql.toLowerCase()).toContain("order by");
    expect(sql.toLowerCase()).toContain("limit");
  });
});

/**
 * The initial transition is the one with no source — it defines what a
 * brand-new row adopts. Selecting it by "from IS NULL" rather than by
 * position means reordering the board can never change where new work
 * starts.
 */
describe("initialStateQuery (W1)", () => {
  const { sql, params } = initialStateQuery("ws_1", "wf_1").toSQL();

  it("is workspace-scoped", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("finds the transition with no source state", () => {
    expect(sql.toLowerCase()).toContain("is null");
  });

  it("takes exactly one", () => {
    expect(sql.toLowerCase()).toContain("limit");
    expect(params).toContain(1);
  });
});
