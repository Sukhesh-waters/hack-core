import { describe, expect, it } from "vitest";
import { insightsQuery, insightByIdQuery } from "./insights";

describe("insightsQuery (G3)", () => {
  const { sql, params } = insightsQuery("ws_1").toSQL();

  it("is workspace-scoped (isolation rule)", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("is bounded and newest-first", () => {
    expect(sql.toLowerCase()).toContain("limit");
    expect(sql.toLowerCase()).toContain("order by");
  });

  /** I2 at the strategy layer: this query must never touch first-party
   *  evidence. If someone later joins posts here, this fails loudly. */
  it("never references the first-party evidence column", () => {
    expect(sql).not.toContain("evidence_post_ids");
    expect(sql.toLowerCase()).not.toContain('"posts"');
  });
});

describe("insightByIdQuery (G2 cross-workspace guard)", () => {
  const { sql, params } = insightByIdQuery("ws_1", "insight_1").toSQL();

  it("is scoped by workspace AND id — an insight from another workspace can never resolve", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("insight_1");
  });
});
