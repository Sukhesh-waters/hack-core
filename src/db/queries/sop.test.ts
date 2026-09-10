import { describe, expect, it } from "vitest";
import {
  activityForRunQuery,
  listSopRunsQuery,
  pendingGateStepsQuery,
  sopRunProgressQuery,
  sopRunQuery,
  sopRunStepsQuery,
  listSopTemplatesQuery,
  sopStepsQuery,
  sopTemplateQuery,
} from "./sop";

describe("listSopTemplatesQuery (S1)", () => {
  const { sql, params } = listSopTemplatesQuery("ws_1").toSQL();

  it("is workspace-scoped (isolation rule)", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  /** Archived templates leave the picker but stay resolvable by id, so a
   *  run already started from one keeps rendering. */
  it("excludes archived templates", () => {
    expect(sql.toLowerCase()).toContain("is null");
  });

  it("is ordered and bounded", () => {
    expect(sql.toLowerCase()).toContain("order by");
    expect(sql.toLowerCase()).toContain("limit");
  });
});

describe("sopTemplateQuery (S1)", () => {
  const { sql, params } = sopTemplateQuery("ws_1", "tpl_1").toSQL();

  /**
   * The id alone must never be the whole lookup: a template id guessed from
   * another workspace has to miss, not resolve.
   */
  it("scopes by workspace AND id, not id alone", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("tpl_1");
  });

  it("is bounded", () => {
    expect(sql.toLowerCase()).toContain("limit");
  });
});

describe("sopStepsQuery (S1)", () => {
  const { sql, params } = sopStepsQuery("ws_1", "tpl_1").toSQL();

  /**
   * The child table carries its own workspace_id rather than inheriting
   * isolation from the join. Without this a step is reachable through a
   * foreign template id.
   */
  it("scopes steps by workspace in their own WHERE, not via the parent", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("scopes to one template", () => {
    expect(sql).toContain('"template_id" =');
    expect(params).toContain("tpl_1");
  });

  /** Position is author-controlled and can tie; created_at breaks the tie so
   *  the order is stable between renders rather than whatever the planner
   *  returns. */
  it("orders by position with a stable tiebreak, and is bounded", () => {
    expect(sql.toLowerCase()).toContain("order by");
    expect(sql).toContain('"position"');
    expect(sql).toContain('"created_at"');
    expect(sql.toLowerCase()).toContain("limit");
  });
});

describe("listSopRunsQuery (S2)", () => {
  const { sql, params } = listSopRunsQuery("ws_1").toSQL();

  it("is workspace-scoped (isolation rule)", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  /** Left join, not inner: a run whose client was removed must still list
   *  rather than silently disappearing from the board. */
  it("left-joins the client so a clientless run survives", () => {
    expect(sql.toLowerCase()).toContain("left join");
  });

  it("is ordered newest-first and bounded", () => {
    expect(sql.toLowerCase()).toContain("order by");
    expect(sql.toLowerCase()).toContain("desc");
    expect(sql.toLowerCase()).toContain("limit");
  });
});

describe("sopRunQuery (S2)", () => {
  it("scopes by workspace AND id, not id alone", () => {
    const { sql, params } = sopRunQuery("ws_1", "run_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("run_1");
    expect(sql.toLowerCase()).toContain("limit");
  });
});

describe("sopRunStepsQuery (S2)", () => {
  const { sql, params } = sopRunStepsQuery("ws_1", "run_1").toSQL();

  /** The child table carries its own workspace_id; isolation is never
   *  inherited from the parent run via the id alone. */
  it("scopes steps by workspace in their own WHERE", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("scopes to one run", () => {
    expect(sql).toContain('"run_id" =');
    expect(params).toContain("run_1");
  });

  /** position can tie after a template reorder, so the order needs a
   *  deterministic tiebreak or the run renders differently between loads. */
  it("orders with a stable tiebreak and is bounded", () => {
    expect(sql).toContain('"position"');
    expect(sql).toContain('"due_at"');
    expect(sql).toContain('"created_at"');
    expect(sql.toLowerCase()).toContain("limit");
  });

  it("projects rejection_reason (E3)", () => {
    expect(sql).toContain('"rejection_reason"');
  });
});

describe("sopRunProgressQuery (S2)", () => {
  const { sql, params } = sopRunProgressQuery("ws_1").toSQL();

  it("is workspace-scoped and grouped per run", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
    expect(sql.toLowerCase()).toContain("group by");
    expect(sql.toLowerCase()).toContain("limit");
  });

  /** Skipped counts as closed: it's a decision the step will never happen,
   *  so leaving it in the open tally would make a finished run look stuck. */
  it("counts done and skipped together as closed", () => {
    expect(sql).toContain("'done'");
    expect(sql).toContain("'skipped'");
  });
});

describe("pendingGateStepsQuery (S4)", () => {
  const { sql, params } = pendingGateStepsQuery("ws_1", "approval").toSQL();

  it("is workspace-scoped (isolation rule)", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("selects only the gate kind asked for", () => {
    expect(sql).toContain('"gate" =');
    expect(params).toContain("approval");
  });

  /**
   * A cancelled run's gates are not decisions anyone still needs to make.
   * Leaving them in the queue trains people to ignore the queue.
   */
  it("only surfaces steps in an active run", () => {
    expect(params).toContain("active");
  });

  /** A blocked step is waiting on its dependency, not on the approver. */
  it("only surfaces open steps, never blocked or closed ones", () => {
    expect(params).toContain("ready");
    expect(params).toContain("in_progress");
    expect(params).not.toContain("blocked");
    expect(params).not.toContain("done");
  });

  it("orders by due date and is bounded", () => {
    expect(sql.toLowerCase()).toContain("order by");
    expect(sql).toContain('"due_at"');
    expect(sql.toLowerCase()).toContain("limit");
  });
});

describe("activityForRunQuery (E3)", () => {
  const { sql, params } = activityForRunQuery("ws_1", "run_1", ["step_1", "step_2"]).toSQL();

  it("is workspace-scoped (isolation rule)", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("matches runId and stepIds", () => {
    expect(params).toContain("run_1");
    expect(params).toContain("step_1");
    expect(params).toContain("step_2");
  });

  it("left-joins users for actor name", () => {
    expect(sql.toLowerCase()).toContain("left join");
  });

  it("is ordered newest-first and bounded", () => {
    expect(sql.toLowerCase()).toContain("order by");
    expect(sql.toLowerCase()).toContain("desc");
    expect(sql.toLowerCase()).toContain("limit");
  });
});
