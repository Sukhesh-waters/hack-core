import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";
import type { AssetKind } from "@/lib/assets";

export type AssetListRow = {
  id: string;
  filename: string;
  mime: string;
  bytes: number;
  kind: AssetKind;
  clientId: string | null;
  uploadedById: string;
  linkedType?: string | null;
  linkedId?: string | null;
  createdAt: Date;
};

/**
 * Builder is exported separately from the awaiting wrapper so the test above
 * can call .toSQL() and prove the workspace filter is in the generated SQL.
 * Same shape as src/db/queries/workspace-docs.ts.
 *
 * `storage_path` is NOT selected here: the list page never needs it, and a
 * path that never reaches the client cannot be guessed at.
 */
export function listAssetsQuery(
  workspaceId: string,
  filter?: { clientId?: string; kind?: AssetKind; linkedType?: string; linkedId?: string },
) {
  return db
    .select({
      id: assets.id,
      filename: assets.filename,
      mime: assets.mime,
      bytes: assets.bytes,
      kind: assets.kind,
      clientId: assets.clientId,
      uploadedById: assets.uploadedById,
      linkedType: assets.linkedType,
      linkedId: assets.linkedId,
      createdAt: assets.createdAt,
    })
    .from(assets)
    .where(
      and(
        eq(assets.workspaceId, workspaceId),
        isNull(assets.archivedAt),
        ...(filter?.clientId ? [eq(assets.clientId, filter.clientId)] : []),
        ...(filter?.kind ? [eq(assets.kind, filter.kind)] : []),
        ...(filter?.linkedType ? [eq(assets.linkedType, filter.linkedType)] : []),
        ...(filter?.linkedId ? [eq(assets.linkedId, filter.linkedId)] : []),
      ),
    )
    .orderBy(desc(assets.createdAt));
}

export async function listAssets(
  workspaceId: string,
  filter?: { clientId?: string; kind?: AssetKind; linkedType?: string; linkedId?: string },
): Promise<AssetListRow[]> {
  return listAssetsQuery(workspaceId, filter);
}

/**
 * Lists all active assets attached to a specific entity (e.g. ticket, direct_message, content).
 */
export function listLinkedAssetsQuery(
  workspaceId: string,
  linkedType: string,
  linkedId: string,
) {
  return db
    .select({
      id: assets.id,
      filename: assets.filename,
      mime: assets.mime,
      bytes: assets.bytes,
      kind: assets.kind,
      clientId: assets.clientId,
      uploadedById: assets.uploadedById,
      linkedType: assets.linkedType,
      linkedId: assets.linkedId,
      createdAt: assets.createdAt,
    })
    .from(assets)
    .where(
      and(
        eq(assets.workspaceId, workspaceId),
        eq(assets.linkedType, linkedType),
        eq(assets.linkedId, linkedId),
        isNull(assets.archivedAt),
      ),
    )
    .orderBy(desc(assets.createdAt));
}

export async function listLinkedAssets(
  workspaceId: string,
  linkedType: string,
  linkedId: string,
): Promise<AssetListRow[]> {
  return listLinkedAssetsQuery(workspaceId, linkedType, linkedId);
}

/** Workspace + id scoped. Returns archived rows too — the caller decides. */
export function getAssetByIdQuery(workspaceId: string, assetId: string) {
  return db
    .select({
      id: assets.id,
      storagePath: assets.storagePath,
      filename: assets.filename,
      mime: assets.mime,
      archivedAt: assets.archivedAt,
    })
    .from(assets)
    .where(and(eq(assets.workspaceId, workspaceId), eq(assets.id, assetId)))
    .limit(1);
}

export async function getAssetById(workspaceId: string, assetId: string) {
  const rows = await getAssetByIdQuery(workspaceId, assetId);
  return rows[0] ?? null;
}

/**
 * Quota input. Archived rows are excluded because their bytes are already
 * gone from the bucket — counting them would charge a workspace for storage
 * it is not using.
 */
export function workspaceStorageUsedQuery(workspaceId: string) {
  return db
    .select({ used: sql<string>`coalesce(sum(${assets.bytes}), 0)` })
    .from(assets)
    .where(
      and(eq(assets.workspaceId, workspaceId), isNull(assets.archivedAt)),
    );
}

export async function workspaceStorageUsed(
  workspaceId: string,
): Promise<number> {
  const rows = await workspaceStorageUsedQuery(workspaceId);
  // Postgres sum() over bigint comes back as a string via the driver.
  return Number(rows[0]?.used ?? 0);
}

/**
 * Insert with a caller-supplied id. The action generates the id first so it
 * can build the storage path and upload the bytes BEFORE writing the row —
 * a failed upload then leaves no row at all, rather than a row pointing at
 * nothing.
 */
export async function createAsset(input: {
  id: string;
  workspaceId: string;
  clientId?: string;
  uploadedById: string;
  filename: string;
  mime: string;
  bytes: number;
  storagePath: string;
  kind: AssetKind;
  linkedType?: string;
  linkedId?: string;
}): Promise<void> {
  await db.insert(assets).values({
    id: input.id,
    workspaceId: input.workspaceId,
    clientId: input.clientId ?? null,
    uploadedById: input.uploadedById,
    filename: input.filename,
    mime: input.mime,
    bytes: input.bytes,
    storagePath: input.storagePath,
    kind: input.kind,
    linkedType: input.linkedType ?? null,
    linkedId: input.linkedId ?? null,
  });
}

/**
 * Links an existing asset to an entity (e.g. ticket, direct_message, content).
 */
export function linkAssetQuery(
  workspaceId: string,
  assetId: string,
  linkedType: string,
  linkedId: string,
) {
  return db
    .update(assets)
    .set({ linkedType, linkedId })
    .where(
      and(
        eq(assets.workspaceId, workspaceId),
        eq(assets.id, assetId),
        isNull(assets.archivedAt),
      ),
    );
}

export async function linkAsset(
  workspaceId: string,
  assetId: string,
  linkedType: string,
  linkedId: string,
): Promise<void> {
  await linkAssetQuery(workspaceId, assetId, linkedType, linkedId);
}

/**
 * Unlinks an asset from an entity without archiving or deleting the underlying asset.
 */
export function unlinkAssetQuery(workspaceId: string, assetId: string) {
  return db
    .update(assets)
    .set({ linkedType: null, linkedId: null })
    .where(
      and(
        eq(assets.workspaceId, workspaceId),
        eq(assets.id, assetId),
        isNull(assets.archivedAt),
      ),
    );
}

export async function unlinkAsset(
  workspaceId: string,
  assetId: string,
): Promise<void> {
  await unlinkAssetQuery(workspaceId, assetId);
}

/**
 * Soft delete, guard-in-WHERE. Returns the storage path so the caller can
 * remove the bytes; an empty result means "not in this workspace" and the
 * caller must not touch storage.
 */
export function archiveAssetQuery(workspaceId: string, assetId: string) {
  return db
    .update(assets)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(assets.workspaceId, workspaceId),
        eq(assets.id, assetId),
        isNull(assets.archivedAt),
      ),
    )
    .returning({ storagePath: assets.storagePath });
}

export async function archiveAsset(
  workspaceId: string,
  assetId: string,
): Promise<string | null> {
  const rows = await archiveAssetQuery(workspaceId, assetId);
  return rows[0]?.storagePath ?? null;
}
