import { describe, expect, it } from "vitest";
import {
  brandChunksQuery,
  brainChunksQuery,
  dueReceiptsQuery,
  gateEventsQuery,
  outcomesQuery,
  receiptsQuery,
  scanSpecsQuery,
  signalDocumentsQuery,
  similarBrainChunksQuery,
  similarBrandChunksQuery,
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
    const { sql } = brainChunksQuery("ws_p").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain("active");
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
    const { sql } = dueReceiptsQuery("ws_p", new Date()).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain("pending");
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
});
