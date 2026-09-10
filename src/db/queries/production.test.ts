import { describe, expect, it } from "vitest";
import {
  advanceStageQuery,
  productionQueueQuery,
  seedDraftBodyQuery,
} from "./production";

describe("productionQueueQuery", () => {
  it("is workspace-scoped (isolation rule)", () => {
    const { sql, params } = productionQueueQuery("ws_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("only surfaces rows with a production stage set", () => {
    const { sql } = productionQueueQuery("ws_1").toSQL();
    expect(sql.toLowerCase()).toContain("is not null");
  });
});

/**
 * Stage moves guard on the current stage (productionStage=from) so a stale or
 * concurrent drag matches 0 rows and advanceStage can report "already moved"
 * instead of a silent no-op that looks successful.
 */
describe("advanceStageQuery — race guard", () => {
  const { sql, params } = advanceStageQuery({
    workspaceId: "ws_1",
    contentId: "content_1",
    from: "brief",
    to: "in_progress",
  }).toSQL();

  it("requires the current stage to still be 'from'", () => {
    expect(sql).toContain('"production_stage" =');
    expect(params).toContain("brief");
  });

  it("is scoped to workspace AND content id", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("content_1");
  });

  it("returns the moved id so a lost race is detectable", () => {
    expect(sql).toContain("returning");
  });
});

/**
 * Manual draft entry (G1) is the only body-write path for cards born on the
 * kanban or calendar, which insert body: "". The empty-body predicate is a
 * race guard, not a convenience: two people on the same stranded card must
 * not silently overwrite each other.
 */
describe("seedDraftBodyQuery — G1 manual draft entry", () => {
  const { sql, params } = seedDraftBodyQuery({
    workspaceId: "ws_1",
    contentId: "content_1",
    body: "## Caption\nhi\n\n## Script\nyo\n\n## Hashtags\n#a\n\n## CTA\ngo",
  }).toSQL();

  it("is scoped to workspace AND content id (isolation rule)", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("content_1");
  });

  it("only writes when the body is still empty", () => {
    expect(sql.toLowerCase()).toContain("is null");
    expect(params).toContain("");
  });

  it("returns the id so a 0-row result can be reported as a lost race", () => {
    expect(sql.toLowerCase()).toContain("returning");
  });
});
