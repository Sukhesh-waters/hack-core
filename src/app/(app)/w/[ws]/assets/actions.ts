"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import {
  archiveAsset,
  createAsset,
  getAssetById,
  linkAsset,
  unlinkAsset,
  workspaceStorageUsed,
} from "@/db/queries/assets";
import { requireCapability } from "@/db/queries/memberships";
import { actionErrorMessage } from "@/lib/action-errors";
import {
  archiveAssetSchema,
  checkAssetUpload,
  linkAssetSchema,
  safeFilename,
  storagePathFor,
  unlinkAssetSchema,
  uploadAssetSchema,
} from "@/lib/assets";
import { putObject, removeObject, signedUrlFor } from "@/lib/storage";

export type UploadAssetState = { error?: string; ok?: string } | undefined;
export type ArchiveAssetState = { error?: string } | undefined;
export type LinkAssetState = { error?: string; ok?: string } | undefined;

/**
 * Guard order is load-bearing and asserted in actions.test.ts:
 *   parse → authenticate → capability (membership is inside it) → quota
 *   → policy → upload bytes → insert row.
 *
 * Bytes are written BEFORE the row, so a failed upload leaves nothing at
 * all. The reverse order would leave a row pointing at an object that does
 * not exist, which the UI would render as a broken file with no way back.
 * The insert's own failure path removes the bytes it just wrote.
 */
export async function uploadAssetAction(
  _prev: UploadAssetState,
  formData: FormData,
): Promise<UploadAssetState> {
  const parsed = uploadAssetSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    clientId: formData.get("clientId"),
    linkedType: formData.get("linkedType"),
    linkedId: formData.get("linkedId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, clientId, linkedType, linkedId } = parsed.data;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }

  let storagePath: string | undefined;
  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "asset.upload");

    const usedBytes = await workspaceStorageUsed(workspaceId);
    const check = checkAssetUpload({
      filename: file.name,
      mime: file.type,
      bytes: file.size,
      usedBytes,
    });
    if (!check.ok) return { error: check.reason };

    const assetId = crypto.randomUUID();
    storagePath = storagePathFor(workspaceId, assetId);

    await putObject(storagePath, await file.arrayBuffer(), file.type);

    try {
      await createAsset({
        id: assetId,
        workspaceId,
        clientId,
        uploadedById: user.id,
        filename: safeFilename(file.name),
        mime: file.type,
        bytes: file.size,
        storagePath,
        kind: check.kind,
        linkedType,
        linkedId,
      });
    } catch (insertError) {
      // The bytes are already in the bucket and nothing references them.
      // Best-effort cleanup; the original error is what the user sees.
      await removeObject(storagePath).catch(() => {});
      throw insertError;
    }
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  if (linkedType === "ticket" && linkedId) {
    revalidatePath(`/w/${workspaceId}/tickets/${linkedId}`);
  } else if (linkedType === "content" && linkedId) {
    revalidatePath(`/w/${workspaceId}/studio/${linkedId}`);
  }
  revalidatePath(`/w/${workspaceId}/assets`);
  return { ok: `Uploaded ${safeFilename(file.name)}.` };
}

/**
 * Link an existing asset to a work item (e.g. ticket or content).
 */
export async function linkAssetAction(
  _prev: LinkAssetState,
  formData: FormData,
): Promise<LinkAssetState> {
  const parsed = linkAssetSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    assetId: formData.get("assetId"),
    linkedType: formData.get("linkedType"),
    linkedId: formData.get("linkedId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, assetId, linkedType, linkedId } = parsed.data;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "asset.upload");
    await linkAsset(workspaceId, assetId, linkedType, linkedId);
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  if (linkedType === "ticket") {
    revalidatePath(`/w/${workspaceId}/tickets/${linkedId}`);
  } else if (linkedType === "content") {
    revalidatePath(`/w/${workspaceId}/studio/${linkedId}`);
  }
  revalidatePath(`/w/${workspaceId}/assets`);
  return { ok: "Linked asset." };
}

/**
 * Unlinks an asset from an entity without deleting the file from storage.
 */
export async function unlinkAssetAction(
  _prev: LinkAssetState,
  formData: FormData,
): Promise<LinkAssetState> {
  const parsed = unlinkAssetSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    assetId: formData.get("assetId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, assetId } = parsed.data;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "asset.upload");
    await unlinkAsset(workspaceId, assetId);
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  const linkedType = formData.get("linkedType");
  const linkedId = formData.get("linkedId");
  if (linkedType === "ticket" && typeof linkedId === "string") {
    revalidatePath(`/w/${workspaceId}/tickets/${linkedId}`);
  } else if (linkedType === "content" && typeof linkedId === "string") {
    revalidatePath(`/w/${workspaceId}/studio/${linkedId}`);
  }
  revalidatePath(`/w/${workspaceId}/assets`);
  return { ok: "Detached asset." };
}

/**
 * Archive is soft for the row and hard for the bytes: the audit trail of who
 * uploaded what survives, the storage quota is actually freed.
 *
 * archiveAsset() returns null when the id is not in this workspace, which is
 * how a cross-workspace archive attempt is stopped before storage is touched.
 */
export async function archiveAssetAction(
  _prev: ArchiveAssetState,
  formData: FormData,
): Promise<ArchiveAssetState> {
  const parsed = archiveAssetSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    assetId: formData.get("assetId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, assetId } = parsed.data;

  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "asset.delete");

    const storagePath = await archiveAsset(workspaceId, assetId);
    if (!storagePath) {
      return { error: "That file is not in this workspace, or is already archived." };
    }
    await removeObject(storagePath);
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/assets`);
  return undefined;
}

/**
 * Called on click from the client list, not a form action. Membership is
 * required (any member may read the workspace's files); the workspace-scoped
 * lookup is what prevents reading another workspace's object by guessing an
 * id — the path is never sent to the browser, only the short-lived URL.
 */
export async function getAssetDownloadUrl(
  workspaceId: string,
  assetId: string,
): Promise<{ url?: string; error?: string }> {
  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "asset.upload");

    const asset = await getAssetById(workspaceId, assetId);
    if (!asset) return { error: "That file is not in this workspace." };
    if (asset.archivedAt) {
      return { error: "That file was archived — its contents are gone." };
    }

    return { url: await signedUrlFor(asset.storagePath) };
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}
