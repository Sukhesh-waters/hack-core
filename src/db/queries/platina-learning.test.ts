import { describe, expect, it } from "vitest";
import {
  confirmedResultsQuery,
  creativesForPlanQuery,
  creativesQuery,
  learningEventsQuery,
  metricsForCreativesQuery,
  promoteBrainChunkQuery,
  reviewsQuery,
  unembeddedFirstPartyChunksQuery,
  firstPartyChunkCountsQuery,
  ownSiteClientsQuery,
  ownSitePagesQuery,
  keywordFirstPartyChunksQuery,
  similarFirstPartyChunksQuery,
  consolidatableBrainQuery,
  latestSuggestionsForSubjectsQuery,
  learningSnapshotsQuery,
  suggestionByIdQuery,
  suggestionEventsQuery,
  suggestionsQuery,
} from "./platina-learning";

describe("C6 queries filter workspace_id in the generated SQL", () => {
  it("ownSitePagesQuery", () => {
    const { sql, params } = ownSitePagesQuery("ws_a", "b1").toSQL();
    expect(sql).toContain('"platina_own_site_pages"."workspace_id" =');
    expect(params).toContain("ws_a");
  });

  it("ownSiteClientsQuery only reads active own brands with a website", () => {
    const { sql, params } = ownSiteClientsQuery("ws_a").toSQL();
    expect(sql).toContain('"platina_brands"."workspace_id" =');
    expect(sql).toContain('"platina_brands"."kind" =');
    expect(params).toEqual(expect.arrayContaining(["ws_a", "own_brand", "active"]));
  });

  it("keywordFirstPartyChunksQuery: workspace, live passages, client scope, bound words (C8.4)", () => {
    const { sql, params } = keywordFirstPartyChunksQuery("ws_a", ["pfas", "lc", "water"], { brandId: "b1" }).toSQL();
    expect(sql).toContain('"platina_first_party_chunks"."workspace_id" = ');
    expect(sql).toContain("superseded_at");
    expect(sql).toContain("ilike");
    expect(params).toEqual(expect.arrayContaining(["ws_a", "b1", "%pfas%", "%water%"]));
    expect(params).not.toContain("%lc%");
  });

  it("similarFirstPartyChunksQuery: workspace, live, current embedding model, optional client scope", () => {
    const unscoped = similarFirstPartyChunksQuery("ws_a", [0.1, 0.2]).toSQL();
    expect(unscoped.sql).toContain('"platina_first_party_chunks"."workspace_id" =');
    expect(unscoped.sql).toContain('"platina_first_party_chunks"."superseded_at" is null');
    expect(unscoped.sql).toContain('"platina_first_party_chunks"."embedding_model_version" =');
    expect(unscoped.sql).not.toContain('"brand_id" =');

    const scoped = similarFirstPartyChunksQuery("ws_a", [0.1], { brandId: "b1" }).toSQL();
    expect(scoped.sql).toContain('"platina_first_party_chunks"."brand_id" =');
    expect(scoped.params).toEqual(expect.arrayContaining(["ws_a", "b1"]));
  });

  it("firstPartyChunkCountsQuery", () => {
    const { sql, params } = firstPartyChunkCountsQuery("ws_a").toSQL();
    expect(sql).toContain('"platina_first_party_chunks"."workspace_id" =');
    expect(params).toContain("ws_a");
  });
});

describe("C6 learning-loop queries filter workspace_id", () => {
  const cases: [string, { toSQL: () => { sql: string; params: unknown[] } }, string][] = [
    ["creativesQuery", creativesQuery("ws_a", "b1"), '"platina_creatives"."workspace_id" ='],
    ["creativesForPlanQuery", creativesForPlanQuery("ws_a", "plan1"), '"platina_creatives"."workspace_id" ='],
    ["metricsForCreativesQuery", metricsForCreativesQuery("ws_a", ["c1"]), '"platina_creative_metrics"."workspace_id" ='],
    ["reviewsQuery", reviewsQuery("ws_a", ["c1"]), '"platina_creative_reviews"."workspace_id" ='],
    ["learningEventsQuery", learningEventsQuery("ws_a"), '"platina_learning_events"."workspace_id" ='],
    ["unembeddedFirstPartyChunksQuery", unembeddedFirstPartyChunksQuery("ws_a"), '"platina_first_party_chunks"."workspace_id" ='],
    ["promoteBrainChunkQuery", promoteBrainChunkQuery("ws_a", "chunk1", 0.05, 0.95), '"workspace_id" ='],
  ];
  for (const [name, query, expected] of cases) {
    it(name, () => {
      const { sql, params } = query.toSQL();
      expect(sql).toContain(expected);
      expect(params).toContain("ws_a");
    });
  }

  it("confirmedResultsQuery filters BOTH joined tables and only confirmed reviews", () => {
    const { sql, params } = confirmedResultsQuery("ws_a", "b1").toSQL();
    expect(sql).toContain('"platina_creative_reviews"."workspace_id" =');
    expect(sql).toContain('"platina_creatives"."workspace_id" =');
    expect(sql).toContain('"platina_creative_reviews"."status" =');
    expect(params).toEqual(expect.arrayContaining(["ws_a", "confirmed", "b1"]));
  });

  it("promotion only touches active insights", () => {
    const { sql, params } = promoteBrainChunkQuery("ws_a", "chunk1", 0.05, 0.95).toSQL();
    expect(sql).toContain('"status" =');
    expect(params).toContain("active");
  });
});

describe("C8.5 ledger queries filter workspace_id in the generated SQL", () => {
  it.each([
    ["suggestionsQuery", suggestionsQuery("ws_a", { kind: "idea", status: "open" })],
    ["suggestionByIdQuery", suggestionByIdQuery("ws_a", "s1")],
    ["latestSuggestionsForSubjectsQuery", latestSuggestionsForSubjectsQuery("ws_a", "opportunity", ["event:x"])],
    ["suggestionEventsQuery", suggestionEventsQuery("ws_a", "s1")],
    ["learningSnapshotsQuery", learningSnapshotsQuery("ws_a")],
    ["consolidatableBrainQuery", consolidatableBrainQuery("ws_a")],
  ] as const)("%s", (_name, query) => {
    const { sql, params } = query.toSQL();
    expect(sql).toMatch(/"workspace_id" = /);
    expect(params).toContain("ws_a");
  });

  it("the consolidation only reads unkeyed (debate and idea) insights, active or archived", () => {
    const { sql, params } = consolidatableBrainQuery("ws_a").toSQL();
    expect(sql).toContain('"insight_key" is null');
    expect(params).toEqual(expect.arrayContaining(["active", "archived"]));
  });
});
