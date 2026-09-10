import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";

describe("workspace isolation (constitution rule)", () => {
  it("every workspace-scoped table has a workspace_id column", () => {
    for (const [name, table] of Object.entries(
      schema.workspaceScopedTables,
    )) {
      const columns = getTableColumns(table);
      expect(
        columns.workspaceId,
        `${name} is missing workspaceId`,
      ).toBeDefined();
      expect(columns.workspaceId.notNull, `${name}.workspaceId is nullable`)
        .toBe(true);
    }
  });

  it("every workspace-scoped table indexes workspace_id", () => {
    for (const [name, table] of Object.entries(
      schema.workspaceScopedTables,
    )) {
      const { indexes } = getTableConfig(table);
      const hasWorkspaceIndex = indexes.some((idx) =>
        idx.config.columns.some(
          (col) => "name" in col && col.name === "workspace_id",
        ),
      );
      expect(hasWorkspaceIndex, `${name} has no workspace_id index`).toBe(
        true,
      );
    }
  });

  it("memberships are unique per (workspace, user)", () => {
    const { indexes } = getTableConfig(schema.memberships);
    const unique = indexes.find((idx) => idx.config.unique);
    expect(unique).toBeDefined();
  });
});

describe("tenancy hierarchy", () => {
  it("workspaces belong to orgs", () => {
    const columns = getTableColumns(schema.workspaces);
    expect(columns.orgId).toBeDefined();
    expect(columns.orgId.notNull).toBe(true);
  });

  it("membership roles match the wedge scope (no org_admin/client_viewer yet)", () => {
    expect(schema.membershipRole.enumValues).toEqual([
      "owner",
      "admin",
      "member",
    ]);
  });
});

describe("two-layer separation metadata (constitution rule)", () => {
  it("ingestion tables carry a source column", () => {
    expect(getTableColumns(schema.posts).source).toBeDefined();
    expect(getTableColumns(schema.postEmbeddings).source).toBeDefined();
  });

  it("posts default to the first-party layer with neutral weight available", () => {
    const columns = getTableColumns(schema.posts);
    expect(columns.source.default).toBe("first_party");
    expect(columns.weight).toBeDefined();
  });

  it("new ingestion tables are registered as workspace-scoped", () => {
    expect(schema.workspaceScopedTables).toMatchObject({
      posts: schema.posts,
      importJobs: schema.importJobs,
      postEmbeddings: schema.postEmbeddings,
    });
  });
});

describe("pattern layer namespace (constitution rule)", () => {
  it("pattern_posts defaults to the public layer with neutral weight", () => {
    const columns = getTableColumns(schema.patternPosts);
    expect(columns.source.default).toBe("public");
    expect(columns.weight.default).toBe(1);
  });

  it("pattern_posts structurally cannot carry performance truth — no score columns", () => {
    const columns = getTableColumns(schema.patternPosts);
    expect(columns).not.toHaveProperty("zScore");
    expect(columns).not.toHaveProperty("direction");
    expect(columns).not.toHaveProperty("scoreStatus");
    expect(columns).not.toHaveProperty("engagementRate");
  });

  it("connector tables are registered as workspace-scoped", () => {
    expect(schema.workspaceScopedTables).toMatchObject({
      connectedAccounts: schema.connectedAccounts,
      patternPosts: schema.patternPosts,
    });
  });

  it("one connection per provider per client", () => {
    const { indexes } = getTableConfig(schema.connectedAccounts);
    expect(indexes.some((idx) => idx.config.unique)).toBe(true);
  });
});

describe("intelligence tables (Phase 3)", () => {
  it("brand_profiles and ideas are workspace-scoped", () => {
    expect(schema.workspaceScopedTables).toMatchObject({
      brandProfiles: schema.brandProfiles,
      ideas: schema.ideas,
    });
  });

  it("one brand profile per client (cached, runs once)", () => {
    const { indexes } = getTableConfig(schema.brandProfiles);
    expect(indexes.some((idx) => idx.config.unique)).toBe(true);
  });

  it("ideas carry citations for the why-this-idea chip", () => {
    expect(getTableColumns(schema.ideas).citations).toBeDefined();
  });

  it("content drafts can trace back to their idea", () => {
    expect(getTableColumns(schema.content).ideaId).toBeDefined();
  });
});

describe("Brand Gene knowledge tables", () => {
  it("knowledge_sources and knowledge_chunks are workspace-scoped", () => {
    expect(schema.workspaceScopedTables).toMatchObject({
      knowledgeSources: schema.knowledgeSources,
      knowledgeChunks: schema.knowledgeChunks,
    });
  });

  it("knowledge_chunks embedding is nullable — a chunk can exist before it's embedded", () => {
    const columns = getTableColumns(schema.knowledgeChunks);
    expect(columns.embedding).toBeDefined();
    expect(columns.embedding.notNull).toBe(false);
  });

  it("knowledge_chunks trace back to their source URL", () => {
    expect(getTableColumns(schema.knowledgeChunks).sourceId).toBeDefined();
  });
});
