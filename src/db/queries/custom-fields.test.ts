import { describe, expect, it } from "vitest";
import {
  allFieldsQuery,
  archiveFieldQuery,
  fieldsForSubjectQuery,
  setContentCustomFieldsQuery,
} from "./custom-fields";

describe("fieldsForSubjectQuery (F2)", () => {
  const { sql, params } = fieldsForSubjectQuery("ws_1", "content").toSQL();

  it("is workspace-scoped (isolation rule)", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("returns only fields attached to that subject type", () => {
    expect(sql).toContain('"subject_type" =');
    expect(params).toContain("content");
  });

  /**
   * Archived fields stop being offered on forms but stay resolvable by id,
   * so a row that legitimately holds a value under one still renders it.
   */
  it("excludes archived definitions", () => {
    expect(sql.toLowerCase()).toContain("is null");
  });

  it("is ordered and bounded", () => {
    expect(sql.toLowerCase()).toContain("order by");
    expect(sql.toLowerCase()).toContain("limit");
  });
});

describe("allFieldsQuery (F2)", () => {
  it("is workspace-scoped and bounded", () => {
    const { sql, params } = allFieldsQuery("ws_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
    expect(sql.toLowerCase()).toContain("limit");
  });
});

describe("setContentCustomFieldsQuery (F2)", () => {
  it("is scoped to workspace AND content id", () => {
    const { sql, params } = setContentCustomFieldsQuery({
      workspaceId: "ws_1",
      contentId: "c_1",
      merged: { f_1: "x" },
    }).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("c_1");
  });
});

describe("archiveFieldQuery (F2)", () => {
  const { sql, params } = archiveFieldQuery("ws_1", "f_1").toSQL();

  it("is workspace-scoped, so a field id alone is not enough", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("is idempotent — archiving twice cannot rewrite the original date", () => {
    expect(sql.toLowerCase()).toContain("is null");
    expect(sql.toLowerCase()).toContain("returning");
  });
});
