import { describe, expect, it } from "vitest";
import {
  getWorkspaceDocBySlugQuery,
  listStaleWorkspaceDocsQuery,
  listWorkspaceDocsQuery,
  updateWorkspaceDocQuery,
} from "./workspace-docs";

describe("workspace docs queries (workspace isolation)", () => {
  it("list query is scoped to workspace and orders by updated_at desc", () => {
    const { sql, params } = listWorkspaceDocsQuery("ws_isolation_test").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_isolation_test");
    expect(sql).toMatch(/order by .*"updated_at" desc/i);
  });

  it("list query never selects the body column (small list payload)", () => {
    const { sql } = listWorkspaceDocsQuery("ws_1").toSQL();
    expect(sql).not.toMatch(/"body"/i);
  });

  it("list query selects kind (V2: lets the list page section docs vs SOPs)", () => {
    const { sql } = listWorkspaceDocsQuery("ws_1").toSQL();
    expect(sql).toMatch(/"kind"/i);
  });

  it("by-slug lookup is scoped to the (workspace_id, slug) composite", () => {
    const { sql, params } = getWorkspaceDocBySlugQuery(
      "ws_isolation_test",
      "onboarding",
    ).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"slug" =');
    expect(params).toContain("ws_isolation_test");
    expect(params).toContain("onboarding");
  });

  it("update query is workspace+id scoped and bumps updated_at", () => {
    const { sql, params } = updateWorkspaceDocQuery("ws_1", "doc_1", {
      title: "New title",
      updatedById: "user_1",
    }).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(sql).toMatch(/"updated_at" = \$?\d/i);
    expect(params).toContain("ws_1");
    expect(params).toContain("doc_1");
    expect(params).toContain("user_1");
  });

  it("listStaleWorkspaceDocsQuery is workspace-scoped and filters by cutoff", () => {
    const { sql, params } = listStaleWorkspaceDocsQuery("ws_isolation_test", 30).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_isolation_test");
    expect(sql.toLowerCase()).toContain("updated_at");
  });
});
