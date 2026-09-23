import { describe, expect, it } from "vitest";
import {
  auditRunEventsQuery,
  auditRunsQuery,
  brandByIdQuery,
  brainEvidenceSinceQuery,
  ownPagesQuery,
  brandChunksQuery,
  brandsQuery,
  findingBrandQuery,
  planRevisionsQuery,
  providerFailuresSinceQuery,
  signalIdsForBrandsQuery,
  competitorsOfQuery,
  docCountForBrandsQuery,
  findingsForBrandsQuery,
  findingTitleExistsQuery,
  openFindingsForUseCaseQuery,
  brandDocCountsQuery,
  brandFindingsQuery,
  latestDocumentQuery,
  pagesTodayQuery,
  recentBrainEvidenceQuery,
  recentBrandEvidenceQuery,
  scanSpecsForBrandQuery,
  signalProvenanceQuery,
  transcriptsSinceQuery,
  brainChunksQuery,
  docsSinceQuery,
  dueReceiptsQuery,
  findingsQuery,
  findingsSinceQuery,
  latestRunEventQuery,
  firstPartyOutcomesQuery,
  gateEventsQuery,
  outcomesQuery,
  receiptsQuery,
  scanSpecsQuery,
  signalDocumentsQuery,
  similarBrainChunksQuery,
  similarBrandChunksQuery,
  brandStandardChunkCountQuery,
  previousSignalDocumentQuery,
  clientScopeSignalsQuery,
  flowBrainSampleQuery,
  flowCountsSql,
  eventParticipantsQuery,
  workspaceEventParticipantsQuery,
  workspaceWideSignalIdsQuery,
  activeInsightChunksQuery,
  eventSourceDocsQuery,
  eventsQuery,
  interestSignalsQuery,
  interestSourceDocsQuery,
  unprocessedSignalsQuery,
} from "./platina";

describe("platina query isolation", () => {
  it("interest queries filter workspace_id (documents AND the specs they came from)", () => {
    const docs = interestSourceDocsQuery("ws_i", ["b1"], new Date(0)).toSQL();
    expect(docs.sql).toContain('"platina_signal_documents"."workspace_id" =');
    expect(docs.sql).toContain('"platina_scan_specs"."workspace_id" =');
    expect(docs.params.filter((p) => p === "ws_i")).toHaveLength(2);
    const signals = interestSignalsQuery("ws_i", ["b1"], new Date(0)).toSQL();
    expect(signals.sql).toContain('"workspace_id" =');
    expect(signals.params).toContain("ws_i");
  });

  it("event queries filter workspace_id (documents, the spec join, events, participants)", () => {
    const docs = eventSourceDocsQuery("ws_e", new Date(0)).toSQL();
    expect(docs.sql).toContain('"platina_signal_documents"."workspace_id" =');
    expect(docs.sql).toContain('"platina_scan_specs"."workspace_id" =');
    expect(docs.params.filter((p) => p === "ws_e")).toHaveLength(2);
    const events = eventsQuery("ws_e").toSQL();
    expect(events.sql).toContain('"workspace_id" =');
    expect(events.params).toContain("ws_e");
    const people = eventParticipantsQuery("ws_e", ["e1"]).toSQL();
    expect(people.sql).toContain('"workspace_id" =');
    expect(people.params).toContain("ws_e");
  });

  it("render-path and insight queries filter workspace_id (including subqueries)", () => {
    const signals = clientScopeSignalsQuery("ws_r", "client_1", new Date(0)).toSQL();
    expect(signals.sql).toContain('"platina_interest_signals"."workspace_id" =');
    expect(signals.sql).toContain('"platina_brands"."workspace_id" =');
    expect(signals.params.filter((p) => p === "ws_r")).toHaveLength(2);
    for (const q of [
      workspaceEventParticipantsQuery("ws_r"),
      workspaceWideSignalIdsQuery("ws_r"),
      activeInsightChunksQuery("ws_r", "event:"),
    ]) {
      const { sql, params } = q.toSQL();
      expect(sql).toContain('"workspace_id" =');
      expect(params).toContain("ws_r");
    }
  });

  it("live-flow snapshot filters workspace_id in EVERY subquery", async () => {
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const { sql, params } = new PgDialect().sqlToQuery(flowCountsSql("ws_f", new Date(0), "2026-09-22"));
    const froms = sql.match(/ from "/g)?.length ?? 0;
    expect(froms).toBeGreaterThanOrEqual(20);
    expect(params.filter((p) => p === "ws_f")).toHaveLength(froms);
    const sample = flowBrainSampleQuery("ws_f").toSQL();
    expect(sample.sql).toContain('"workspace_id" =');
    expect(sample.params).toContain("ws_f");
  });

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

  it("previousSignalDocumentQuery finds the version before this one, in this workspace only", () => {
    const before = new Date("2026-09-21T10:00:00Z");
    const { sql, params } = previousSignalDocumentQuery(
      "ws_p",
      "https://acme.com/pricing",
      before,
    ).toSQL();
    expect(sql).toContain(String.raw`"workspace_id" =`);
    expect(sql).toContain(String.raw`"canonical_url" =`);
    // Strictly BEFORE: the document being analysed must not match itself.
    expect(sql).toContain(String.raw`"fetched_at" <`);
    expect(sql).toContain("order by");
    expect(sql).toContain("limit");
    // Drizzle serialises the timestamp parameter.
    expect(params).toEqual(
      expect.arrayContaining([
        "ws_p",
        "https://acme.com/pricing",
        before.toISOString(),
      ]),
    );
  });

  it("recentBrandEvidenceQuery scopes the standard to one client when asked (R3)", () => {
    const scoped = recentBrandEvidenceQuery("ws_p", 10, "brand_1").toSQL();
    expect(scoped.sql).toContain(String.raw`"workspace_id" =`);
    expect(scoped.sql).toContain(String.raw`"brand_id" =`);
    expect(scoped.params).toEqual(expect.arrayContaining(["ws_p", "brand_1"]));

    // Without a brand it stays workspace-wide, as it was before R3.
    const wide = recentBrandEvidenceQuery("ws_p", 10).toSQL();
    expect(wide.sql).toContain(String.raw`"workspace_id" =`);
    expect(wide.sql).not.toContain(String.raw`"brand_id" =`);
  });

  it("brandStandardChunkCountQuery counts only live chunks for one client", () => {
    const { sql, params } = brandStandardChunkCountQuery("ws_p", "brand_1").toSQL();
    expect(sql).toContain(String.raw`"workspace_id" =`);
    expect(sql).toContain(String.raw`"brand_id" =`);
    expect(sql).toContain(String.raw`"superseded_at" is null`);
    expect(params).toEqual(expect.arrayContaining(["ws_p", "brand_1"]));
  });

  it("firstPartyOutcomesQuery excludes synthetic demo rows (A4)", () => {
    const { sql, params } = firstPartyOutcomesQuery("ws_p").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"synthetic" =');
    expect(params).toEqual(expect.arrayContaining(["ws_p", false]));
  });

  it("brand queries filter workspace_id (a brand in ws A is not read for ws B)", () => {
    for (const q of [
      brandsQuery("ws_a"),
      brandByIdQuery("ws_a", "b1"),
      competitorsOfQuery("ws_a", "b1"),
      scanSpecsForBrandQuery("ws_a", "b1"),
    ]) {
      const { sql, params } = q.toSQL();
      expect(sql).toContain('"workspace_id" =');
      expect(params).toContain("ws_a");
      expect(params).not.toContain("ws_b");
    }
  });

  it("competitorsOfQuery only returns competitors of the given parent", () => {
    const { params } = competitorsOfQuery("ws_a", "parent-1").toSQL();
    expect(params).toEqual(expect.arrayContaining(["ws_a", "competitor", "parent-1"]));
  });

  it("joined per-brand queries carry workspace_id on EVERY table they touch", () => {
    for (const q of [findingsForBrandsQuery("ws_a", ["b1"]), docCountForBrandsQuery("ws_a", ["b1"])]) {
      const { sql, params } = q.toSQL();
      const filters = sql.match(/"workspace_id" =/g) ?? [];
      expect(filters.length).toBeGreaterThanOrEqual(2);
      expect(params.filter((p) => p === "ws_a").length).toBe(filters.length);
    }
  });

  it("throughput, provenance and stage helper queries are workspace-scoped", () => {
    const since = new Date("2026-09-20T00:00:00Z");
    for (const q of [
      pagesTodayQuery("ws_a", "2026-09-20"),
      transcriptsSinceQuery("ws_a", since),
      recentBrainEvidenceQuery("ws_a", 5),
      recentBrandEvidenceQuery("ws_a", 5),
      signalProvenanceQuery("ws_a", ["s1"]),
      latestDocumentQuery("ws_a"),
      findingTitleExistsQuery("ws_a", "brand_divergence", "t"),
      openFindingsForUseCaseQuery("ws_a", "ideation"),
      brandDocCountsQuery("ws_a", ["b1"]),
      brandFindingsQuery("ws_a", ["b1"]),
    ]) {
      const { sql, params } = q.toSQL();
      expect(sql).toContain('"workspace_id" =');
      expect(params).toContain("ws_a");
    }
  });

  it("real-time planning queries are workspace-scoped, including every joined table", () => {
    const since = new Date("2026-09-20T00:00:00Z");
    for (const q of [
      brainEvidenceSinceQuery("ws_a", since),
      planRevisionsQuery("ws_a", "p1"),
      providerFailuresSinceQuery("ws_a", since),
    ]) {
      const { sql, params } = q.toSQL();
      expect(sql).toContain("workspace_id");
      expect(params).toContain("ws_a");
    }
    for (const q of [signalIdsForBrandsQuery("ws_a", ["b1"]), findingBrandQuery("ws_a", "f1")]) {
      const { sql, params } = q.toSQL();
      const filters = sql.match(/"workspace_id" =/g) ?? [];
      expect(filters.length).toBeGreaterThanOrEqual(2);
      expect(params.filter((p) => p === "ws_a").length).toBe(filters.length);
    }
  });

  it("a client's own pages are read workspace-scoped on both tables, and only that client's", () => {
    const { sql, params } = ownPagesQuery("ws_a", "brand_1").toSQL();
    const filters = sql.match(/"workspace_id" =/g) ?? [];
    expect(filters.length).toBeGreaterThanOrEqual(2);
    expect(params.filter((p) => p === "ws_a").length).toBe(filters.length);
    expect(params).toContain("brand_1");
    expect(sql).not.toContain("embedding");
  });

  it("the analysis backlog also picks up a claim whose worker died (stale or never timestamped)", () => {
    const { sql, params } = unprocessedSignalsQuery("ws_a", 5, new Date("2026-09-20T12:00:00Z")).toSQL();
    expect(sql).toContain("processing_started_at");
    expect(sql).toContain("is null");
    expect(params).toEqual(expect.arrayContaining(["ws_a", "unprocessed", "processing"]));
  });

  it("the provider-swap read is scoped to failed attempts only", () => {
    const { params } = providerFailuresSinceQuery("ws_a", new Date()).toSQL();
    expect(params).toContain("failed");
  });

  it("the unprocessed backlog is read newest first so it cannot hide fresh signals", () => {
    expect(unprocessedSignalsQuery("ws_a", 50).toSQL().sql).toMatch(/order by .*"created_at" desc/i);
  });

  it("health counters are workspace-scoped", () => {
    const since = new Date("2026-09-20T00:00:00Z");
    for (const q of [
      docsSinceQuery("ws_p", since),
      findingsSinceQuery("ws_p", since),
      latestRunEventQuery("ws_p"),
    ]) {
      const { sql, params } = q.toSQL();
      expect(sql).toContain('"workspace_id" =');
      expect(params).toContain("ws_p");
    }
  });
});
