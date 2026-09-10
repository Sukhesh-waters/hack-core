import { describe, expect, it } from "vitest";
import { planViewQuery } from "./plan-views";

describe("planViewQuery (U7)", () => {
  const { sql, params } = planViewQuery("ws_1", "user_1").toSQL();

  /**
   * Per user AND per workspace: an operator running three clients wants a
   * different default in each, and a user-only key would let the last
   * workspace they touched overwrite the others.
   */
  it("is keyed by workspace AND user", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"user_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("user_1");
  });

  it("reads at most one row", () => {
    expect(sql.toLowerCase()).toContain("limit");
  });
});
