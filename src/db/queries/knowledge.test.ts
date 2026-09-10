import { describe, expect, it } from "vitest";
import {
  createAssetKnowledgeSourceQuery,
  knowledgeSourcesQuery,
  similarKnowledgeChunksQuery,
} from "./knowledge";

const WS = "ws_isolation_test";
const CLIENT = "client_isolation_test";

describe("knowledge queries (workspace isolation)", () => {
  it("knowledgeSourcesQuery is workspace AND client scoped", () => {
    const { sql, params } = knowledgeSourcesQuery(WS, CLIENT).toSQL();
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"client_id" =');
    expect(params).toContain(WS);
    expect(params).toContain(CLIENT);
  });

  it("similarKnowledgeChunksQuery is workspace+client scoped, cosine-ordered, and excludes null embeddings", () => {
    const { sql, params } = similarKnowledgeChunksQuery(WS, CLIENT, [
      0.1, 0.2,
    ]).toSQL();
    expect(sql).toContain("<=>");
    expect(sql).toContain('"workspace_id" =');
    expect(sql).toContain('"client_id" =');
    expect(sql.toLowerCase()).toContain("is not null");
    expect(params).toContain(WS);
    expect(params).toContain(CLIENT);
  });

  it("createAssetKnowledgeSourceQuery includes workspace_id, client_id, asset_id, and source_kind", () => {
    const { sql, params } = createAssetKnowledgeSourceQuery(
      WS,
      CLIENT,
      "asset_123",
      "Brand Guidelines",
    ).toSQL();
    expect(sql).toContain('"workspace_id"');
    expect(sql).toContain('"client_id"');
    expect(sql).toContain('"asset_id"');
    expect(sql).toContain('"source_kind"');
    expect(params).toContain(WS);
    expect(params).toContain(CLIENT);
    expect(params).toContain("asset_123");
    expect(params).toContain("Brand Guidelines");
    expect(params).toContain("asset");
  });
});
