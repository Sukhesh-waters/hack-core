import { describe, expect, it } from "vitest";
import { activityForSubjectQuery } from "./activity";

/**
 * Separate file from activity.test.ts on purpose: that one mocks the db to
 * observe writes, this one needs the real query builder to assert SQL shape.
 */
describe("activityForSubjectQuery (S6)", () => {
  const { sql, params } = activityForSubjectQuery(
    "ws_1",
    "content",
    "content_1",
  ).toSQL();

  it("is workspace-scoped (isolation rule)", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("is scoped to one subject, by type AND id", () => {
    expect(sql).toContain('"subject_type" =');
    expect(sql).toContain('"subject_id" =');
    expect(params).toContain("content");
    expect(params).toContain("content_1");
  });

  it("is never unbounded", () => {
    expect(sql.toLowerCase()).toContain("limit");
  });

  it("reads newest first", () => {
    expect(sql.toLowerCase()).toContain("desc");
  });
});
