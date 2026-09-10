import { describe, expect, it } from "vitest";
import {
  getRevisionQuery,
  markRevisionAppliedQuery,
  pendingRevisionsQuery,
  revisionsForContentQuery,
} from "./revisions";

describe("revisionsForContentQuery (S4)", () => {
  const { sql, params } = revisionsForContentQuery("ws_1", "content_1").toSQL();

  it("is scoped to workspace AND content id (isolation rule)", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"content_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("content_1");
  });

  it("is never unbounded", () => {
    expect(sql.toLowerCase()).toContain("limit");
  });

  it("LEFT JOINs the author so AI revisions still appear", () => {
    // authorId is null for authorKind "ai" — an INNER JOIN would hide
    // exactly the revisions this table exists to hold.
    expect(sql.toLowerCase()).toContain("left join");
  });
});

describe("pendingRevisionsQuery (S4)", () => {
  const { sql, params } = pendingRevisionsQuery("ws_1", "content_1").toSQL();

  it("is workspace-scoped", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("returns only unapplied proposals", () => {
    expect(sql.toLowerCase()).toContain("is null");
  });
});

describe("getRevisionQuery (S4)", () => {
  it("is workspace-scoped, so a revision id alone is not enough", () => {
    const { sql, params } = getRevisionQuery("ws_1", "rev_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("rev_1");
  });
});

/**
 * Applying is the one mutation this append-only table allows, and it is a
 * race: two people accepting the same suggestion must not both apply it.
 */
describe("markRevisionAppliedQuery — race guard (S4)", () => {
  const { sql, params } = markRevisionAppliedQuery({
    workspaceId: "ws_1",
    revisionId: "rev_1",
    appliedById: "user_1",
  }).toSQL();

  it("only applies a revision that is still unapplied", () => {
    expect(sql.toLowerCase()).toContain("is null");
  });

  it("is scoped to workspace AND revision id", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(params).toContain("ws_1");
  });

  it("returns the id so a lost race is reportable", () => {
    expect(sql.toLowerCase()).toContain("returning");
  });
});
