import { describe, expect, it } from "vitest";
import {
  automationRulesQuery,
  automationRunsForRuleQuery,
  automationRunsQuery,
  deleteAutomationRuleQuery,
  hasRecentAutomationRunQuery,
  listEnabledAutomationRulesQuery,
  recentFailedAutomationRunsQuery,
  setAutomationRuleEnabledQuery,
  staleNewIdeasQuery,
  stalePendingApprovalsQuery,
  unassignedHighPriorityTicketsQuery,
  updateAutomationRuleQuery,
} from "./automations";

const WS = "ws_1";

describe("automationRulesQuery", () => {
  it("is workspace-scoped (isolation rule)", () => {
    const { sql, params } = automationRulesQuery(WS).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain(WS);
  });
});

describe("hasRecentAutomationRunQuery (G3 dedupe ledger)", () => {
  it("is scoped to workspace, rule id, and the cutoff window", () => {
    const cutoff = new Date("2026-08-08T12:00:00Z");
    const { sql, params } = hasRecentAutomationRunQuery(
      WS,
      "rule_1",
      cutoff,
    ).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"rule_id" =');
    expect(sql).toContain('"created_at" >=');
    expect(params).toContain(WS);
    expect(params).toContain("rule_1");
    expect(params).toContain(cutoff.toISOString());
  });
});

describe("setAutomationRuleEnabledQuery (guard-in-WHERE)", () => {
  it("is scoped to workspace AND rule id, and returns the row", () => {
    const { sql, params } = setAutomationRuleEnabledQuery(
      WS,
      "rule_1",
      true,
    ).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(sql).toContain("returning");
    expect(params).toContain(WS);
    expect(params).toContain("rule_1");
    expect(params).toContain(true);
  });
});

describe("updateAutomationRuleQuery", () => {
  it("is workspace-and-id scoped", () => {
    const { sql, params } = updateAutomationRuleQuery(WS, "rule_1", {
      name: "New name",
    }).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(params).toContain(WS);
    expect(params).toContain("rule_1");
    expect(params).toContain("New name");
  });
});

describe("deleteAutomationRuleQuery", () => {
  it("is scoped to workspace AND rule id, returns the deleted id", () => {
    const { sql, params } = deleteAutomationRuleQuery(WS, "rule_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(sql).toContain("returning");
    expect(params).toContain(WS);
    expect(params).toContain("rule_1");
  });
});

/**
 * Cross-workspace cron sweep — the ONE intentional exception to the
 * workspace-scoping rule in this file, same idiom as dueRemindersQuery
 * (src/db/queries/schedule.ts) and listEnabledHarnessRules
 * (src/db/queries/harness.ts). This test proves the exception is
 * deliberate, not a bug: no workspace_id predicate anywhere in the SQL,
 * only the enabled=true filter.
 */
describe("listEnabledAutomationRulesQuery (cron sweep — intentionally NOT workspace-scoped)", () => {
  it("has no workspace_id predicate in the WHERE clause", () => {
    const { sql } = listEnabledAutomationRulesQuery().toSQL();
    const whereClause = sql.slice(sql.toLowerCase().indexOf(" where "));
    expect(whereClause).not.toContain("workspace_id");
  });

  it("filters only on enabled = true", () => {
    const { sql, params } = listEnabledAutomationRulesQuery().toSQL();
    expect(sql).toContain('"enabled" =');
    expect(params).toEqual([true]);
  });
});

describe("automationRunsQuery", () => {
  it("is workspace-scoped and limited", () => {
    const { sql, params } = automationRunsQuery(WS, 20).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain("limit");
    expect(params).toContain(WS);
    expect(params).toContain(20);
  });
});

describe("automationRunsForRuleQuery", () => {
  it("is scoped to workspace AND rule id, and limited", () => {
    const { sql, params } = automationRunsForRuleQuery(
      WS,
      "rule_1",
      5,
    ).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"rule_id" =');
    expect(sql).toContain("limit");
    expect(params).toContain(WS);
    expect(params).toContain("rule_1");
    expect(params).toContain(5);
  });
});

describe("recentFailedAutomationRunsQuery (V3 Marketing OS overview)", () => {
  it("is workspace-scoped, filters status=failed, joins rule name, and is limited", () => {
    const { sql, params } = recentFailedAutomationRunsQuery(WS, 5).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"status" =');
    expect(sql).toContain("inner join");
    expect(sql).toContain("limit");
    expect(params).toContain(WS);
    expect(params).toContain("failed");
    expect(params).toContain(5);
  });
});

describe("staleNewIdeasQuery (idea_stale trigger)", () => {
  it("is workspace-scoped and guards status=new + createdAt < cutoff", () => {
    const cutoff = new Date("2026-07-17T10:00:00Z");
    const { sql, params } = staleNewIdeasQuery(WS, cutoff).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"status" =');
    expect(sql).toContain('"created_at" <');
    expect(params).toContain(WS);
    expect(params).toContain("new");
    expect(params).toContain(cutoff.toISOString());
  });
});

describe("stalePendingApprovalsQuery (approval_stale trigger)", () => {
  it("is workspace-scoped and guards status=pending + createdAt < cutoff", () => {
    const cutoff = new Date("2026-07-20T04:00:00Z");
    const { sql, params } = stalePendingApprovalsQuery(WS, cutoff).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"status" =');
    expect(sql).toContain('"created_at" <');
    expect(params).toContain(WS);
    expect(params).toContain("pending");
    expect(params).toContain(cutoff.toISOString());
  });
});

describe("unassignedHighPriorityTicketsQuery (ticket_unassigned trigger)", () => {
  it("is workspace-scoped and guards priority=high, assignee null, status!=done, createdAt < cutoff", () => {
    const cutoff = new Date("2026-07-19T10:00:00Z");
    const { sql, params } = unassignedHighPriorityTicketsQuery(
      WS,
      cutoff,
    ).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"priority" =');
    expect(sql).toContain('"assignee_id" is null');
    expect(sql).toContain('"status" <>');
    expect(sql).toContain('"created_at" <');
    expect(params).toContain(WS);
    expect(params).toContain("high");
    expect(params).toContain("done");
    expect(params).toContain(cutoff.toISOString());
  });
});
