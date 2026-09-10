import { describe, expect, it } from "vitest";
import {
  cycleTimeByStateQuery,
  overdueLoadQuery,
  ownerLoadQuery,
  wipVsLimitQuery,
  MIN_N_THRESHOLD,
} from "./metrics";

describe("D2 — Metrics Queries", () => {
  describe("cycleTimeByStateQuery", () => {
    const { sql, params } = cycleTimeByStateQuery("ws_test").toSQL();

    it("is workspace-scoped", () => {
      expect(sql).toContain('"workspace_id" =');
      expect(params).toContain("ws_test");
    });

    it("filters for stage_advanced content activity", () => {
      expect(params).toContain("content");
      expect(params).toContain("stage_advanced");
    });

    it("is bounded by limit", () => {
      expect(sql.toLowerCase()).toContain("limit");
    });

    it("MIN_N_THRESHOLD is configured to 5 for Min-N gate", () => {
      expect(MIN_N_THRESHOLD).toBe(5);
    });
  });

  describe("wipVsLimitQuery", () => {
    const { sql, params } = wipVsLimitQuery("ws_test").toSQL();

    it("is workspace-scoped for both workflow_states and content", () => {
      expect(sql).toContain('"workspace_id" =');
      expect(params).toContain("ws_test");
    });

    it("is ordered by position and bounded", () => {
      expect(sql.toLowerCase()).toContain("order by");
      expect(sql.toLowerCase()).toContain("limit");
    });
  });

  describe("overdueLoadQuery", () => {
    const { sql, params } = overdueLoadQuery("ws_test").toSQL();

    it("is workspace-scoped", () => {
      expect(sql).toContain('"workspace_id" =');
      expect(params).toContain("ws_test");
    });

    it("only includes active runs and open steps past due_at", () => {
      expect(params).toContain("active");
      expect(params).toContain("done");
      expect(params).toContain("skipped");
      expect(sql.toLowerCase()).toContain("due_at");
    });

    it("is ordered by due_at and bounded", () => {
      expect(sql.toLowerCase()).toContain("order by");
      expect(sql.toLowerCase()).toContain("limit");
    });
  });

  describe("ownerLoadQuery", () => {
    const { sql, params } = ownerLoadQuery("ws_test").toSQL();

    it("is workspace-scoped", () => {
      expect(sql).toContain('"workspace_id" =');
      expect(params).toContain("ws_test");
    });

    it("aggregates open steps, tickets, and content per owner in SQL", () => {
      expect(sql.toLowerCase()).toContain("sop_run_steps");
      expect(sql.toLowerCase()).toContain("tickets");
      expect(sql.toLowerCase()).toContain("content");
    });

    it("is bounded", () => {
      expect(sql.toLowerCase()).toContain("limit");
    });
  });
});
