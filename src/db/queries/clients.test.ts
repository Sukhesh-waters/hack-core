import { describe, expect, it } from "vitest";
import { setClientContactEmailQuery } from "./clients";

describe("setClientContactEmailQuery (isolation rule)", () => {
  it("is scoped to workspace AND client id in the WHERE clause", () => {
    const { sql, params } = setClientContactEmailQuery(
      "ws_1",
      "client_1",
      "client@example.com",
    ).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("client_1");
    expect(params).toContain("client@example.com");
  });

  it("returns the updated row id so the caller can detect a missing client", () => {
    const { sql } = setClientContactEmailQuery(
      "ws_1",
      "client_1",
      "client@example.com",
    ).toSQL();
    expect(sql.toLowerCase()).toContain("returning");
  });

  it("can clear the contact email back to null", () => {
    const { params } = setClientContactEmailQuery(
      "ws_1",
      "client_1",
      null,
    ).toSQL();
    expect(params).toContain(null);
  });
});
