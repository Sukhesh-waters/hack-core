import { describe, expect, it } from "vitest";
import { applyTransitionQuery, contentByStateQuery } from "./workflow";

/**
 * The guard is the whole point of this query. `workflow_state_id = from` in
 * the WHERE is what makes a raced or stale move match zero rows instead of
 * applying twice — the caller checks the returned count and reports "already
 * moved" rather than silently succeeding.
 */
describe("applyTransitionQuery (W2)", () => {
  const base = {
    workspaceId: "ws_1",
    contentId: "c_1",
    fromStateId: "s_brief",
    toStateId: "s_in_progress",
  };

  it("guards on the state we believed the row was in", () => {
    const { sql, params } = applyTransitionQuery({
      ...base,
      legacyStage: "in_progress",
    }).toSQL();
    expect(sql).toContain('"workflow_state_id" =');
    expect(params).toContain("s_brief");
  });

  it("is scoped to workspace AND row id (isolation rule)", () => {
    const { sql, params } = applyTransitionQuery({
      ...base,
      legacyStage: "in_progress",
    }).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("c_1");
  });

  it("returns the id so a lost race is detectable", () => {
    const { sql } = applyTransitionQuery({
      ...base,
      legacyStage: "in_progress",
    }).toSQL();
    expect(sql.toLowerCase()).toContain("returning");
  });

  it("dual-writes production_stage when the target mirrors an enum value", () => {
    const { sql, params } = applyTransitionQuery({
      ...base,
      legacyStage: "in_progress",
    }).toSQL();
    expect(sql).toContain('"production_stage"');
    expect(params).toContain("in_progress");
  });

  /**
   * A custom state has no enum word. Writing one anyway would either throw
   * or corrupt the legacy column, so the update simply omits it — the new
   * column is authoritative and the old one stops tracking, which is
   * exactly what "this workspace has customised" means.
   */
  it("leaves production_stage untouched for a custom state", () => {
    const { sql } = applyTransitionQuery({
      ...base,
      legacyStage: null,
    }).toSQL();
    expect(sql).toContain('"workflow_state_id"');
    expect(sql).not.toContain('"production_stage"');
  });
});

describe("contentByStateQuery (W2)", () => {
  const { sql, params } = contentByStateQuery("ws_1").toSQL();

  it("is workspace-scoped", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("orders by board position so columns render in the admin's order", () => {
    expect(sql.toLowerCase()).toContain("order by");
    expect(sql).toContain('"position"');
  });

  it("is bounded", () => {
    expect(sql.toLowerCase()).toContain("limit");
  });

  /** INNER JOIN, not LEFT: a row with no workflow state isn't on the board
   *  yet, and inventing a column for it would show work nobody staged. */
  it("only returns rows that are actually on a workflow", () => {
    expect(sql.toLowerCase()).toContain("inner join");
  });

  /**
   * Regression — found by moving a card into a custom state in the browser
   * and watching the board file it under the wrong column.
   *
   * The board must key off workflow_state_id, the column the engine writes.
   * Joining on production_stage = legacy_stage looks equivalent and is not:
   * a card in a state the enum has no word for keeps whatever stage it last
   * had, so a legacy-keyed board shows it in its OLD column forever.
   */
  it("keys cards off workflow_state_id, never the legacy stage", () => {
    expect(sql).toContain('"workflow_state_id"');
    expect(sql).not.toContain('"legacy_stage"');
  });

  it("returns the client name so the board needs no second query", () => {
    expect(sql).toContain('"name"');
  });

  /**
   * P0 (counterattack-12) — cards show WHO owns the work. The users join
   * must be LEFT, not INNER: an unassigned card is still on the board, and
   * an inner join would silently drop it the moment nobody owned it.
   */
  it("resolves the assignee's display name without dropping unassigned cards", () => {
    expect(sql).toContain('"assignee_id"');
    expect(sql.toLowerCase()).toContain("left join");
    expect(sql).toContain('"users"');
  });
});
