"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/auth";
import { getAssetById } from "@/db/queries/assets";
import { getClientById } from "@/db/queries/clients";
import {
  createAssetKnowledgeSource,
  insertKnowledgeChunks,
  updateKnowledgeSource,
} from "@/db/queries/knowledge";
import { requireMembership } from "@/db/queries/memberships";
import { actionErrorMessage } from "@/lib/action-errors";
import { routeAI } from "@/lib/ai/router";
import { runWithAiCost } from "@/lib/ai/usage-context";
import {
  extractTextFromAsset,
  isIngestibleMime,
} from "@/lib/asset-extract";
import { chunkText } from "@/lib/knowledge-ingest";
import { getObject } from "@/lib/storage";

const ingestAssetSchema = z.object({
  workspaceId: z.string().min(1, "Missing workspace."),
  clientId: z.string().min(1, "Choose a client for this knowledge source."),
  assetId: z.string().min(1, "Missing asset."),
});

export type IngestAssetState = { error?: string; ok?: string } | undefined;

/**
 * Ingests an uploaded file from the Workspace Asset Library into the client's
 * Knowledge Base and Brand DNA vector memory.
 *
 * Guard order:
 *   parse → authenticate → membership → client validity → asset validity
 *   → mime check → pending source insert → download bytes → extract text
 *   → chunk → embed → insert chunks → update source ready.
 *
 * Fail-soft: Any downstream failure after row creation updates the source
 * to status="failed" with the error message so the audit trail is preserved.
 */
export async function ingestAssetToKnowledgeBaseAction(
  _prev: IngestAssetState,
  formData: FormData,
): Promise<IngestAssetState> {
  const parsed = ingestAssetSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    clientId: formData.get("clientId"),
    assetId: formData.get("assetId"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { workspaceId, clientId, assetId } = parsed.data;

  let asset: Awaited<ReturnType<typeof getAssetById>>;
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const client = await getClientById(workspaceId, clientId);
    if (!client) {
      return { error: "Client not found in this workspace." };
    }

    asset = await getAssetById(workspaceId, assetId);
    if (!asset) {
      return { error: "File not found in this workspace." };
    }

    if (asset.archivedAt) {
      return { error: "This file was archived and cannot be ingested." };
    }

    if (!isIngestibleMime(asset.mime)) {
      return {
        error: `"${asset.filename}" cannot be ingested. Only documents and data files (PDF, Markdown, CSV, plain text) are supported.`,
      };
    }
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  let sourceId: string;
  try {
    const source = await createAssetKnowledgeSource(
      workspaceId,
      clientId,
      assetId,
      asset.filename,
    );
    sourceId = source.id;
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  try {
    const buffer = await getObject(asset.storagePath);
    const text = await extractTextFromAsset(
      buffer,
      asset.mime,
      asset.filename,
    );

    const chunks = chunkText(text, { maxChars: 1200, overlapChars: 150 });
    if (chunks.length === 0) {
      throw new Error("No readable chunks could be extracted from this file.");
    }

    const vectors = await runWithAiCost(
      { workspaceId, purpose: "knowledge-ingest" },
      () => routeAI({ kind: "embed", texts: chunks }),
    );

    await insertKnowledgeChunks(
      chunks.map((content, i) => ({
        workspaceId,
        clientId,
        sourceId,
        chunkIndex: i,
        content,
        embedding: vectors[i] ?? null,
      })),
    );

    await updateKnowledgeSource(workspaceId, sourceId, {
      status: "ready",
      title: asset.filename,
      chunkCount: chunks.length,
      error: null,
    });

    revalidatePath(`/w/${workspaceId}/assets`);
    revalidatePath(`/w/${workspaceId}/brand-gene`);
    revalidatePath(`/w/${workspaceId}/kb`);

    return {
      ok: `Ingested ${asset.filename} into knowledge base (${chunks.length} chunks).`,
    };
  } catch (error) {
    const message = actionErrorMessage(error);
    try {
      await updateKnowledgeSource(workspaceId, sourceId, {
        status: "failed",
        error: message,
      });
    } catch {
      // Best-effort error state update
    }
    return { error: message };
  }
}
