import { describe, expect, it } from "vitest";
import {
  activeRunsQuery,
  aiCostSinceQuery,
  clientNamesQuery,
  draftReviewsCountQuery,
  embedFailuresSinceQuery,
  knowledgeSourcesWithUrlQuery,
  unembeddedBrainCountQuery,
} from "./ops";
import { latestOpsRunQuery, opsAlertRulesQuery, opsHistoryQuery, opsRunChecksQuery } from "./platina-ops";

const since = new Date("2026-09-22T00:00:00Z");

describe("ops board queries filter workspace_id in the generated SQL", () => {
  const cases: [string, { toSQL(): { sql: string; params: unknown[] } }, string][] = [
    ["knowledgeSourcesWithUrlQuery", knowledgeSourcesWithUrlQuery("ws_a"), '"knowledge_sources"."workspace_id" ='],
    ["clientNamesQuery", clientNamesQuery("ws_a"), '"clients"."workspace_id" ='],
    ["embedFailuresSinceQuery", embedFailuresSinceQuery("ws_a", since), '"ai_usage"."workspace_id" ='],
    ["aiCostSinceQuery", aiCostSinceQuery("ws_a", since), '"ai_usage"."workspace_id" ='],
    ["unembeddedBrainCountQuery", unembeddedBrainCountQuery("ws_a"), '"platina_brain_chunks"."workspace_id" ='],
    ["activeRunsQuery", activeRunsQuery("ws_a"), '"platina_audit_runs"."workspace_id" ='],
    ["draftReviewsCountQuery", draftReviewsCountQuery("ws_a"), '"platina_creative_reviews"."workspace_id" ='],
    ["latestOpsRunQuery", latestOpsRunQuery("ws_a"), '"platina_ops_checks"."workspace_id" ='],
    ["opsRunChecksQuery", opsRunChecksQuery("ws_a", "run1"), '"platina_ops_checks"."workspace_id" ='],
    ["opsHistoryQuery", opsHistoryQuery("ws_a", since), '"platina_ops_checks"."workspace_id" ='],
    ["opsAlertRulesQuery", opsAlertRulesQuery("ws_a"), '"platina_alert_rules"."workspace_id" ='],
  ];
  for (const [name, query, filter] of cases) {
    it(name, () => {
      const { sql, params } = query.toSQL();
      expect(sql).toContain(filter);
      expect(params).toContain("ws_a");
    });
  }
});
