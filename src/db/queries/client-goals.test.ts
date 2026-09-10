import { describe, expect, it } from "vitest";
import {
  clientGoalsQuery,
  activeGoalsForClientQuery,
  clientGoalByIdQuery,
} from "./client-goals";

describe("clientGoalsQuery (G1)", () => {
  const { sql, params } = clientGoalsQuery("ws_1", "client_1").toSQL();

  it("is scoped by BOTH workspace and client (isolation rule)", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"client_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("client_1");
  });

  it("is bounded", () => {
    expect(sql.toLowerCase()).toContain("limit");
  });
});

describe("activeGoalsForClientQuery (G1)", () => {
  const { sql, params } = activeGoalsForClientQuery("ws_1", "client_1").toSQL();

  it("is workspace-scoped and filters to active", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("active");
  });
});

describe("clientGoalByIdQuery (G1 — cross-workspace/client guard)", () => {
  const { sql, params } = clientGoalByIdQuery(
    "ws_1",
    "client_1",
    "goal_1",
  ).toSQL();

  it("is scoped by workspace, client, AND goal id — a goal from another client or workspace can never resolve", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"client_id" =');
    expect(sql).toContain('"id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("client_1");
    expect(params).toContain("goal_1");
  });
});
