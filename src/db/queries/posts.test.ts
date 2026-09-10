import { describe, expect, it } from "vitest";
import {
  baselineQuery,
  existingPostExternalIdsQuery,
  firstPartyPostsForClientQuery,
  listExistingPostExternalIds,
  postsByIdsQuery,
  similarPostsQuery,
  topMoversQuery,
} from "./posts";

/**
 * Two-layer rule (constitution, CI gate): a public/Apify row must never
 * surface as performance truth. The baseline engine's query is asserted at
 * the SQL level — Phase 2 adds the live-DB version of this proof.
 */
describe("layer separation guardrail", () => {
  const { sql, params } = baselineQuery("ws_1", "client_1").toSQL();

  it("hard-filters the baseline to the first-party layer", () => {
    expect(sql).toContain('"source" =');
    expect(params).toContain("first_party");
    expect(params).not.toContain("public");
  });

  it("is workspace-scoped (isolation rule)", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("is client-scoped — one account's baseline, not the workspace's", () => {
    expect(sql).toContain('"client_id" =');
    expect(params).toContain("client_1");
  });
});

/**
 * G2 — the decision evidence picker (and the server-side allow-list
 * validateDecisionEvidence checks against) must draw from first-party rows
 * only, same discipline as the baseline engine above.
 */
describe("firstPartyPostsForClientQuery — decision evidence guardrail", () => {
  const { sql, params } = firstPartyPostsForClientQuery(
    "ws_1",
    "client_1",
  ).toSQL();

  it("hard-filters to the first-party layer", () => {
    expect(sql).toContain('"source" =');
    expect(params).toContain("first_party");
    expect(params).not.toContain("public");
  });

  it("is workspace- and client-scoped", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"client_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("client_1");
  });

  it("is bounded", () => {
    expect(sql.toLowerCase()).toContain("limit");
  });
});

/**
 * Phase 3 retrieval guardrails: the driver brief and idea citations can only
 * ever be built from first-party rows (two-layer rule, CI gate).
 */
describe("retrieval layer separation guardrail", () => {
  it("similarity search is hard-filtered to first-party on BOTH tables", () => {
    const { sql, params } = similarPostsQuery("ws_1", "client_1", [
      0.1, 0.2,
    ]).toSQL();
    expect(sql).toContain("<=>");
    expect(sql).toContain('"workspace_id" =');
    expect(params.filter((p) => p === "first_party")).toHaveLength(2);
    expect(params).toContain("ws_1");
  });

  it("top movers read scored first-party rows only, workspace-scoped", () => {
    const { sql, params } = topMoversQuery("ws_1", "client_1", "up", 5).toSQL();
    expect(sql).toContain('"source" =');
    expect(params).toContain("first_party");
    expect(params).toContain("up");
    expect(params).toContain("ws_1");
  });
});

/**
 * Connector-sync dedup guard: a Meta pull re-fetches the same recent media
 * every run, so this query must scope to workspace + client before an
 * externalId collision can be trusted — otherwise one account's dedup could
 * hide another's post, or leak across workspaces.
 */
describe("existingPostExternalIdsQuery — sync dedup scoping", () => {
  const { sql, params } = existingPostExternalIdsQuery("ws_1", "client_1", [
    "ig_1",
    "ig_2",
  ]).toSQL();

  it("is scoped to workspace AND client", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"client_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("client_1");
  });

  it("matches on the supplied external ids", () => {
    expect(sql).toContain('"external_id" in');
    expect(params).toContain("ig_1");
    expect(params).toContain("ig_2");
  });

  it("short-circuits on empty input without touching the DB", async () => {
    await expect(
      listExistingPostExternalIds("ws_1", "client_1", []),
    ).resolves.toEqual([]);
  });
});

/**
 * Citation caption resolution must stay inside the first-party layer — a
 * pattern-layer post can never be surfaced here mislabeled as first-party.
 */
describe("postsByIdsQuery — citation caption two-layer guard", () => {
  const { sql, params } = postsByIdsQuery("ws_1", ["p1", "p2"]).toSQL();

  it("hard-filters to the first-party layer", () => {
    expect(sql).toContain('"source" =');
    expect(params).toContain("first_party");
    expect(params).not.toContain("public");
  });

  it("is workspace-scoped and matches the supplied ids", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("p1");
  });
});
