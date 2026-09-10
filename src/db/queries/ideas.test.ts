import { describe, expect, it } from "vitest";
import {
  claimIdeaForDraftingQuery,
  ideasQuery,
  newIdeasQuery,
} from "./ideas";

describe("ideas queries", () => {
  it("idea reads are workspace-scoped (isolation rule)", () => {
    const { sql, params } = ideasQuery("ws_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });
});

describe("newIdeasQuery (Plan & Validate)", () => {
  it("is workspace-scoped (isolation rule)", () => {
    const { sql, params } = newIdeasQuery("ws_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("only surfaces ideas awaiting a decision", () => {
    const { params } = newIdeasQuery("ws_1").toSQL();
    expect(params).toContain("new");
    expect(params).not.toContain("drafted");
    expect(params).not.toContain("archived");
  });
});

/**
 * Race guard: the accept path claims new → drafted atomically. The claim's
 * WHERE must require status='new' so a second concurrent accept matches 0
 * rows and loses, instead of both generating a draft. (accept-idea.ts checks
 * the returned row count.)
 */
describe("claimIdeaForDrafting (accept-idea race guard)", () => {
  const { sql, params } = claimIdeaForDraftingQuery("ws_1", "idea_1").toSQL();

  it("only claims an idea that is still 'new'", () => {
    expect(sql).toContain('"status" =');
    expect(params).toContain("new");
  });

  it("is scoped to workspace AND idea id", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("idea_1");
  });

  it("returns the claimed id so the caller can detect a lost race", () => {
    expect(sql).toContain("returning");
  });
});
