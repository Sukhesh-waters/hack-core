"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import {
  createKnowledgeSource,
  insertKnowledgeChunks,
  updateKnowledgeSource,
} from "@/db/queries/knowledge";
import { actionErrorMessage } from "@/lib/action-errors";
import { broadcastSignal } from "@/lib/realtime";

const crawlSchema = z.object({
  workspaceId: z.string().min(1),
  clientId: z.string().min(1),
  url: z.string().url("Please provide a valid URL (https://...)"),
});

export type CrawlActionState = {
  ok?: boolean;
  error?: string;
  chunkCount?: number;
};

export async function crawlAndIngestUrlAction(
  _prev: CrawlActionState | undefined,
  formData: FormData,
): Promise<CrawlActionState> {
  const parsed = crawlSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    clientId: formData.get("clientId"),
    url: formData.get("url"),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { workspaceId, clientId, url } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const source = await createKnowledgeSource(workspaceId, clientId, url);

    // Fetch page text
    const res = await fetch(url, {
      headers: {
        "User-Agent": "InstaMediaBot/1.0 (+https://instamedia.ai)",
      },
    });

    if (!res.ok) {
      await updateKnowledgeSource(workspaceId, source.id, {
        status: "failed",
        error: `HTTP ${res.status}: Failed to load URL`,
      });
      return { ok: false, error: `Could not fetch ${url} (HTTP ${res.status})` };
    }

    const html = await res.text();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : url;

    // Clean html tags to extract text blocks
    const cleanText = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (cleanText.length < 50) {
      await updateKnowledgeSource(workspaceId, source.id, {
        status: "failed",
        error: "Insufficient text content on page",
      });
      return { ok: false, error: "Page contained insufficient text content." };
    }

    // Chunk into ~600-character segments
    const chunkSize = 600;
    const rawChunks: string[] = [];
    for (let i = 0; i < cleanText.length; i += chunkSize) {
      const segment = cleanText.slice(i, i + chunkSize).trim();
      if (segment.length > 30) {
        rawChunks.push(segment);
      }
    }

    const chunkRows = rawChunks.map((chunkText, idx) => ({
      workspaceId,
      clientId,
      sourceId: source.id,
      chunkIndex: idx,
      content: chunkText,
      embedding: null,
    }));

    await insertKnowledgeChunks(chunkRows);

    await updateKnowledgeSource(workspaceId, source.id, {
      status: "ready",
      title: pageTitle,
      chunkCount: chunkRows.length,
      error: null,
    });

    void broadcastSignal(workspaceId, "kb");

    revalidatePath(`/w/${workspaceId}/kb`);
    revalidatePath(`/w/${workspaceId}/brand-gene`);

    return { ok: true, chunkCount: chunkRows.length };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}
