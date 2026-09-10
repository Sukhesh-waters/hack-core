import { describe, expect, it } from "vitest";
import { commentsForContentQuery } from "./comments";

describe("comments queries (workspace isolation)", () => {
  it("thread lookup is scoped to workspace AND content", () => {
    const { sql, params } = commentsForContentQuery(
      "ws_isolation_test",
      "content_1",
    ).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"content_id" =');
    expect(params).toContain("ws_isolation_test");
    expect(params).toContain("content_1");
  });
});
