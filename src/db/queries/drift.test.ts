import { describe, expect, it } from "vitest";
import { recentComplianceQuery } from "./drift";

describe("recentComplianceQuery", () => {
  it("is workspace AND client scoped", () => {
    const { sql, params } = recentComplianceQuery(
      "ws_1",
      "client_1",
      20,
    ).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"client_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("client_1");
  });
});
