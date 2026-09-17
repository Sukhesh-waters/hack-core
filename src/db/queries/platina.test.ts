import { describe, expect, it } from "vitest";
import {
  auditRunEventsQuery,
  auditRunsQuery,
  brandChunksQuery,
  brainChunksQuery,
  dueReceiptsQuery,
  findingsQuery,
  firstPartyOutcomesQuery,
  gateEventsQuery,
  outcomesQuery,
  receiptsQuery,
  scanSpecsQuery,
  signalDocumentsQuery,
  similarBrainChunksQuery,
  similarBrandChunksQuery,
  unprocessedSignalsQuery,
} from "./platina";

describe("platina query isolation", () => {
  it("brandChunksQuery filters workspace_id", () => {
    const { sql, params } = brandChunksQuery("ws_p").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_p");
  });

  it("signalDocumentsQuery filters workspace_id and never selects embedding", () => {
    const { sql, params } = signalDocumentsQuery("ws_p").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_p");
    expect(sql).not.toContain("embedding");
  });

  it("brainChunksQuery filters workspace_id and active status", () => {
    const { sql, params } = brainChunksQuery("ws_p").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("active");
  });

  it("gateEventsQuery is workspace-scoped", () => {
    const { sql } = gateEventsQuery("ws_p").toSQL();
    expect(sql).toContain('"workspace_id" =');
  });

  it("scanSpecsQuery is workspace-scoped", () => {
    const { sql } = scanSpecsQuery("ws_p").toSQL();
    expect(sql).toContain('"workspace_id" =');
  });

  it("receipts keep brand and brain evidence as separate columns", () => {
    const { sql } = receiptsQuery("ws_p").toSQL();
    expect(sql).toContain("evidence_brand_ids");
    expect(sql).toContain("evidence_brain_ids");
    expect(sql).not.toMatch(/evidence_brand_ids.*\|\||union/i);
  });

  it("dueReceiptsQuery is workspace-scoped and pending-only", () => {
    const { sql, params } = dueReceiptsQuery("ws_p", new Date()).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("pending");
  });

  it("outcomesQuery is workspace-scoped", () => {
    const { sql } = outcomesQuery("ws_p").toSQL();
    expect(sql).toContain('"workspace_id" =');
  });

  it("two-bucket retrieval queries stay on separate tables", () => {
    const a = similarBrandChunksQuery("ws_p", [0.1]).toSQL();
    const c = similarBrainChunksQuery("ws_p", [0.1]).toSQL();
    expect(a.sql).toContain("platina_brand_chunks");
    expect(a.sql).not.toContain("platina_brain_chunks");
    expect(c.sql).toContain("platina_brain_chunks");
    expect(c.sql).not.toContain("platina_brand_chunks");
    expect(a.sql).toContain('"workspace_id" =');
    expect(c.sql).toContain('"workspace_id" =');
  });

  it("auditRunsQuery is workspace-scoped", () => {
    const { sql, params } = auditRunsQuery("ws_p").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_p");
    expect(sql).toContain("platina_audit_runs");
  });

  it("auditRunEventsQuery is scoped by workspace AND run", () => {
    const { sql, params } = auditRunEventsQuery("ws_p", "run_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"run_id" =');
    expect(params).toEqual(expect.arrayContaining(["ws_p", "run_1"]));
  });

  it("findingsQuery is workspace-scoped", () => {
    const { sql, params } = findingsQuery("ws_p").toSQL();
    expect(sql).toContain("platina_findings");
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_p");
  });

  it("the contradiction sweep reads only unprocessed signals", () => {
    const { sql, params } = unprocessedSignalsQuery("ws_p").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"processing_state" =');
    expect(params).toEqual(expect.arrayContaining(["ws_p", "unprocessed"]));
  });

  it("firstPartyOutcomesQuery excludes synthetic demo rows (A4)", () => {
    const { sql, params } = firstPartyOutcomesQuery("ws_p").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"synthetic" =');
    expect(params).toEqual(expect.arrayContaining(["ws_p", false]));
  });
});
