import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as platina from "./platina-schema";

describe("platina workspace isolation", () => {
  it("every platina table has a non-null workspace_id", () => {
    for (const [name, table] of Object.entries(
      platina.platinaWorkspaceScopedTables,
    )) {
      const columns = getTableColumns(table);
      expect(columns.workspaceId, `${name} is missing workspaceId`).toBeDefined();
      expect(columns.workspaceId.notNull, `${name}.workspaceId is nullable`).toBe(
        true,
      );
    }
  });

  it("every platina table indexes workspace_id", () => {
    for (const [name, table] of Object.entries(
      platina.platinaWorkspaceScopedTables,
    )) {
      const { indexes } = getTableConfig(table);
      const hasWorkspaceIndex = indexes.some((idx) =>
        idx.config.columns.some(
          (col) => "name" in col && col.name === "workspace_id",
        ),
      );
      expect(hasWorkspaceIndex, `${name} has no workspace_id index`).toBe(true);
    }
  });
});

describe("three-plane structural invariants", () => {
  it("plane A brand chunks carry an embedding column", () => {
    expect(getTableColumns(platina.platinaBrandChunks).embedding).toBeDefined();
  });

  it("plane B signal documents have NO embedding column", () => {
    const columns = getTableColumns(platina.platinaSignalDocuments);
    expect(Object.keys(columns)).not.toContain("embedding");
    expect(columns.body).toBeDefined();
  });

  it("plane C brain chunks carry embedding, confidence, generation, provenance", () => {
    const columns = getTableColumns(platina.platinaBrainChunks);
    expect(columns.embedding).toBeDefined();
    expect(columns.confidence).toBeDefined();
    expect(columns.generation).toBeDefined();
    expect(columns.sourceSignalIds).toBeDefined();
    expect(columns.absorbedChunkIds).toBeDefined();
    expect(columns.transcriptId).toBeDefined();
  });

  it("receipts keep plane-A and plane-C evidence in separate columns", () => {
    const columns = getTableColumns(platina.platinaReceipts);
    expect(columns.evidenceBrandIds).toBeDefined();
    expect(columns.evidenceBrainIds).toBeDefined();
    expect(columns.hypothesis).toBeDefined();
  });

  it("gate events carry approver, decision, and payload hash", () => {
    const columns = getTableColumns(platina.platinaGateEvents);
    expect(columns.approverId).toBeDefined();
    expect(columns.decision).toBeDefined();
    expect(columns.payloadHash).toBeDefined();
    expect(columns.gate).toBeDefined();
  });
});
