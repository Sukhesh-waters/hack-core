import { describe, expect, it } from "vitest";
import { patternQuery } from "./accounts";

describe("pattern layer queries", () => {
  it("pattern reads are workspace-scoped (isolation rule)", () => {
    const { sql, params } = patternQuery("ws_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("pattern reads select from pattern_posts, never from posts", () => {
    const { sql } = patternQuery("ws_1").toSQL();
    expect(sql).toContain('"pattern_posts"');
    expect(sql).not.toContain('"posts"');
  });
});
