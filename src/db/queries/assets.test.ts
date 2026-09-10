import { describe, expect, it } from "vitest";
import {
  archiveAssetQuery,
  getAssetByIdQuery,
  linkAssetQuery,
  listAssetsQuery,
  listLinkedAssetsQuery,
  unlinkAssetQuery,
  workspaceStorageUsedQuery,
} from "./assets";

describe("asset queries (workspace isolation)", () => {
  it("list query is scoped to workspace and newest first", () => {
    const { sql, params } = listAssetsQuery("ws_isolation_test").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(params).toContain("ws_isolation_test");
    expect(sql).toMatch(/order by .*"created_at" desc/i);
  });

  it("list query hides archived rows by default", () => {
    const { sql } = listAssetsQuery("ws_1").toSQL();
    expect(sql).toMatch(/"archived_at" is null/i);
  });

  it("client filter composes with the workspace filter, never replaces it", () => {
    const { sql, params } = listAssetsQuery("ws_1", {
      clientId: "client_9",
    }).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"client_id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("client_9");
  });

  it("kind filter composes with the workspace filter, never replaces it", () => {
    const { sql, params } = listAssetsQuery("ws_1", { kind: "csv" }).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"kind" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("csv");
  });

  it("single-asset lookup is scoped to the (workspace_id, id) composite", () => {
    const { sql, params } = getAssetByIdQuery("ws_1", "asset_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(params).toContain("ws_1");
    expect(params).toContain("asset_1");
  });

  it("usage sum is workspace-scoped and ignores archived rows", () => {
    const { sql, params } = workspaceStorageUsedQuery("ws_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toMatch(/sum\(/i);
    expect(sql).toMatch(/"archived_at" is null/i);
    expect(params).toContain("ws_1");
  });

  it("archive query is workspace+id scoped and sets archived_at", () => {
    const { sql, params } = archiveAssetQuery("ws_1", "asset_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(sql).toMatch(/"archived_at" =/i);
    expect(params).toContain("ws_1");
    expect(params).toContain("asset_1");
  });

  it("archive query returns the storage path so the caller can delete bytes", () => {
    const { sql } = archiveAssetQuery("ws_1", "asset_1").toSQL();
    expect(sql).toMatch(/returning .*"storage_path"/i);
  });

  it("listLinkedAssetsQuery scopes to workspace, linkedType, linkedId and excludes archived", () => {
    const { sql, params } = listLinkedAssetsQuery("ws_1", "ticket", "t_100").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"linked_type" =');
    expect(sql).toContain('"linked_id" =');
    expect(sql).toMatch(/"archived_at" is null/i);
    expect(params).toContain("ws_1");
    expect(params).toContain("ticket");
    expect(params).toContain("t_100");
  });

  it("linkAssetQuery is workspace+id scoped and sets linked_type and linked_id", () => {
    const { sql, params } = linkAssetQuery("ws_1", "asset_1", "ticket", "t_100").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(sql).toMatch(/"linked_type" =/i);
    expect(sql).toMatch(/"linked_id" =/i);
    expect(sql).toMatch(/"archived_at" is null/i);
    expect(params).toContain("ws_1");
    expect(params).toContain("asset_1");
    expect(params).toContain("ticket");
    expect(params).toContain("t_100");
  });

  it("unlinkAssetQuery is workspace+id scoped and sets linked_type and linked_id to null", () => {
    const { sql, params } = unlinkAssetQuery("ws_1", "asset_1").toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"id" =');
    expect(sql).toMatch(/"linked_type" =/i);
    expect(sql).toMatch(/"linked_id" =/i);
    expect(params).toContain("ws_1");
    expect(params).toContain("asset_1");
  });
});
