import { describe, expect, it } from "vitest";
import {
  planByIdQuery,
  planFeedbackQuery,
  planLessonsQuery,
  plansWithVerdictQuery,
} from "./platina";

describe("campaign planner query isolation", () => {
  it("plansWithVerdictQuery filters workspace_id on the plans AND the joined feedback", () => {
    const { sql, params } = plansWithVerdictQuery("ws_p").toSQL();
    expect(sql).toContain('"platina_plans"."workspace_id" =');
    expect(sql).toContain('"platina_plan_feedback"."workspace_id" =');
    expect(params.filter((p) => p === "ws_p").length).toBeGreaterThanOrEqual(2);
  });

  it("planByIdQuery scopes by workspace as well as id (a forged id cannot cross tenants)", () => {
    const { sql, params } = planByIdQuery("ws_p", "plan_x").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(params).toEqual(expect.arrayContaining(["ws_p", "plan_x"]));
  });

  it("planFeedbackQuery is workspace-scoped", () => {
    const { sql, params } = planFeedbackQuery("ws_p", "plan_x").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_p");
  });

  it("planLessonsQuery filters workspace on both tables and by verdict", () => {
    const { sql, params } = planLessonsQuery("ws_p", "failed", 3).toSQL();
    expect(sql).toContain('"platina_plan_feedback"."workspace_id" =');
    expect(sql).toContain('"platina_plans"."workspace_id" =');
    expect(params).toContain("failed");
    expect(params.filter((p) => p === "ws_p").length).toBeGreaterThanOrEqual(2);
  });
});
