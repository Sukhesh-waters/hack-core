import { describe, expect, it } from "vitest";
import { listPendingSopSuggestionsQuery } from "./sop-suggestions";

const WS = "ws_suggestions_test";

describe("sopSuggestions queries (workspace isolation + filter contract)", () => {
  it("scopes listPendingSopSuggestionsQuery to workspace_id", () => {
    const { sql, params } = listPendingSopSuggestionsQuery(WS).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain(WS);
  });

  it("filters out applied and dismissed suggestions", () => {
    const { sql } = listPendingSopSuggestionsQuery(WS).toSQL();
    expect(sql.toLowerCase()).toContain("applied_at");
    expect(sql.toLowerCase()).toContain("dismissed_at");
    expect(sql.toLowerCase()).toContain("is null");
  });
});
