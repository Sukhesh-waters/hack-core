import { describe, expect, it } from "vitest";
import {
  decisionsQuery,
  decisionsForClientQuery,
  dueForReviewQuery,
} from "./decisions";

describe("decisionsQuery (G2)", () => {
  const { sql, params } = decisionsQuery("ws_1").toSQL();

  it("is workspace-scoped (isolation rule)", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_1");
  });

  it("is bounded and newest-first", () => {
    expect(sql.toLowerCase()).toContain("limit");
    expect(sql.toLowerCase()).toContain("order by");
  });

  /** I2 at the strategy layer: a decision listing must never pull in
   *  pattern-layer evidence — that would blur the two layers in the exact
   *  place a reviewer reads "what worked." */
  it("never references the pattern-layer evidence column", () => {
    expect(sql).not.toContain("evidence_pattern_ids");
  });
});

describe("decisionsForClientQuery (G2)", () => {
  const { sql, params } = decisionsForClientQuery("ws_1", "client_1").toSQL();

  it("is scoped by BOTH workspace and client", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"client_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("client_1");
  });
});

describe("dueForReviewQuery (G2 — feeds the daily review cron)", () => {
  const now = new Date("2026-06-15T09:00:00Z");
  const { sql, params } = dueForReviewQuery("ws_1", now).toSQL();

  it("is workspace-scoped AND bounds by review_at", () => {
    expect(sql).toContain('"workspace_id" =');
    expect(sql.toLowerCase()).toContain("review_at");
    expect(params).toContain("ws_1");
  });

  it("only surfaces still-pending decisions", () => {
    expect(sql).toContain('"outcome" =');
    expect(params).toContain("pending");
  });
});
