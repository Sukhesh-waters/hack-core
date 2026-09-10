"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { getClientById } from "@/db/queries/clients";
import {
  createKnowledgeSource,
  insertKnowledgeChunks,
  updateKnowledgeSource,
} from "@/db/queries/knowledge";
import { requireMembership } from "@/db/queries/memberships";
import { actionErrorMessage } from "@/lib/action-errors";
import { routeAI } from "@/lib/ai/router";
import { runWithAiCost } from "@/lib/ai/usage-context";
import {
  chunkText,
  extractReadableText,
  fetchPage,
  MAX_SOURCE_CHARS,
  MIN_EXTRACT_CHARS,
} from "@/lib/knowledge-ingest";
import { ingestUrlSchema } from "@/lib/validation";

export type IngestState = { error?: string } | undefined;

/**
 * Paste-a-URL ingest: fetch → extract → chunk → embed → store. First-party/
 * declared-adjacent material (the client chose to paste it) — never routed
 * through source="public"/pattern-layer tables. A failure at any step marks
 * the source row "failed" with a message rather than throwing unhandled
 * (degradation ladder), matching importCsv's job-row → work → status shape.
 */
export async function ingestKnowledgeUrl(
  _prev: IngestState,
  formData: FormData,
): Promise<IngestState> {
  const parsed = ingestUrlSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    clientId: formData.get("clientId"),
    url: formData.get("url"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, clientId, url } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    const client = await getClientById(workspaceId, clientId);
    if (!client) return { error: "Client not found in this workspace." };
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  const { id: sourceId } = await createKnowledgeSource(
    workspaceId,
    clientId,
    url,
  );

  try {
    const { html } = await fetchPage(url);
    const { title, text } = extractReadableText(html);
    if (text.length < MIN_EXTRACT_CHARS) {
      throw new Error("Couldn't find enough readable text on that page.");
    }
    const chunks = chunkText(text.slice(0, MAX_SOURCE_CHARS));
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
        embedding: vectors[i],
      })),
    );
    await updateKnowledgeSource(workspaceId, sourceId, {
      status: "ready",
      title,
      chunkCount: chunks.length,
      error: null,
    });
  } catch (error) {
    await updateKnowledgeSource(workspaceId, sourceId, {
      status: "failed",
      error: actionErrorMessage(error),
    }).catch(() => {});
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/brand-gene`);
  return undefined;
}
