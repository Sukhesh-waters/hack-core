import { describe, expect, it } from "vitest";
import {
  postsMissingEmbeddingsQuery,
  scorablePostsQuery,
} from "./rescore";

const WS = "ws_isolation_test";

describe("rescore queries (workspace isolation + two-layer rule)", () => {
  it("scorable rows are workspace-scoped AND first-party only", () => {
    const { sql, params } = scorablePostsQuery(WS).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"source" =');
    expect(params).toContain(WS);
    expect(params).toContain("first_party");
  });

  it("embedding backfill is workspace-scoped", () => {
    const { sql, params } = postsMissingEmbeddingsQuery(WS).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain(WS);
  });
});
