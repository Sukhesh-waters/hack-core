"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { getClientById } from "@/db/queries/clients";
import {
  createKnowledgeSource,
  insertKnowledgeChunks,
  listKnowledgeSources,
  updateKnowledgeSource,
} from "@/db/queries/knowledge";
import { requireMembership } from "@/db/queries/memberships";
import { actionErrorMessage } from "@/lib/action-errors";
import { routeAI } from "@/lib/ai/router";
import { runWithAiCost } from "@/lib/ai/usage-context";
import { chunkText, MAX_SOURCE_CHARS, readPage } from "@/lib/knowledge-ingest";
import { mapConcurrent, readSite, type SitePage } from "@/lib/scrape/site";
import { firecrawlConfigured, mapSite, scrapeWithFirecrawl } from "@/lib/scrape/firecrawl";
import { ingestUrlSchema } from "@/lib/validation";

export type IngestState = { error?: string; notice?: string } | undefined;

/** A site ingest reads the same pages again within the hour for free. */
const SITE_CACHE_MS = 60 * 60_000;

/**
 * Paste-a-URL ingest: fetch → extract → chunk → embed → store. First-party/
 * declared-adjacent material (the client chose to paste it) — never routed
 * through source="public"/pattern-layer tables. A failure at any step marks
 * the source row "failed" with a message rather than throwing unhandled
 * (degradation ladder), matching importCsv's job-row → work → status shape.
 *
 * scope=site (the default when Firecrawl is configured) also reads the best
 * pages of the same site — about, products, solutions, news — each stored as
 * its own source so every chunk keeps its provenance and the refresh job keeps
 * each page current. See lib/scrape/site.ts.
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
  const wholeSite = formData.get("scope") === "site" && firecrawlConfigured();

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    const client = await getClientById(workspaceId, clientId);
    if (!client) return { error: "Client not found in this workspace." };
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  const result = wholeSite
    ? await ingestSite(workspaceId, clientId, url)
    : await ingestOnePage(workspaceId, clientId, url);

  revalidatePath(`/w/${workspaceId}/brand-gene`);
  return result;
}

/** Embeds and stores one page's chunks against its source row. */
async function storePage(
  workspaceId: string,
  clientId: string,
  sourceId: string,
  title: string | null,
  chunks: string[],
) {
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
}

async function ingestOnePage(
  workspaceId: string,
  clientId: string,
  url: string,
): Promise<IngestState> {
  const { id: sourceId } = await createKnowledgeSource(workspaceId, clientId, url);
  try {
    // A person is waiting: Firecrawl first (renders JavaScript, gets past
    // most bot walls), our own fetch as the fallback — see readPage.
    const { title, text } = await readPage(url, { prefer: "firecrawl" });
    await storePage(workspaceId, clientId, sourceId, title, chunkText(text.slice(0, MAX_SOURCE_CHARS)));
    return undefined;
  } catch (error) {
    await updateKnowledgeSource(workspaceId, sourceId, {
      status: "failed",
      error: actionErrorMessage(error),
    }).catch(() => {});
    return { error: actionErrorMessage(error) };
  }
}

async function ingestSite(
  workspaceId: string,
  clientId: string,
  url: string,
): Promise<IngestState> {
  // The pasted page gets its row first, so the list shows "Ingesting…" at once.
  const { id: firstId } = await createKnowledgeSource(workspaceId, clientId, url);

  let site: Awaited<ReturnType<typeof readSite>>;
  try {
    site = await readSite(url, {
      map: (u) => mapSite(u),
      scrape: (u) => scrapeWithFirecrawl(u, { maxAgeMs: SITE_CACHE_MS }),
      readText: (u) => readPage(u, { prefer: "direct" }),
      chunkText: (t) => chunkText(t.slice(0, MAX_SOURCE_CHARS)),
    });
  } catch (error) {
    await updateKnowledgeSource(workspaceId, firstId, {
      status: "failed",
      error: actionErrorMessage(error),
    }).catch(() => {});
    return { error: actionErrorMessage(error) };
  }

  // Re-pasting a site must not store its pages twice: a page already in this
  // client's vault is left as it is (the refresh job keeps it current).
  const existing = new Set(
    (await listKnowledgeSources(workspaceId, clientId))
      .filter((s) => s.status === "ready" && s.url)
      .map((s) => s.url as string),
  );
  const [first, ...others] = site.pages;
  const fresh = others.filter((p) => !existing.has(p.url));

  const stored = await mapConcurrent(
    [{ page: first, sourceId: firstId }, ...fresh.map((page) => ({ page, sourceId: "" }))],
    3,
    async ({ page, sourceId }: { page: SitePage; sourceId: string }) => {
      const id = sourceId || (await createKnowledgeSource(workspaceId, clientId, page.url)).id;
      try {
        if (page.chunks.length === 0) throw new Error("Couldn't find enough readable text on that page.");
        await storePage(workspaceId, clientId, id, page.title, page.chunks);
        return page.chunks.length;
      } catch (error) {
        await updateKnowledgeSource(workspaceId, id, {
          status: "failed",
          error: actionErrorMessage(error),
        }).catch(() => {});
        return 0;
      }
    },
  );

  const chunks = stored.reduce((sum, n) => sum + n, 0);
  if (chunks === 0) {
    return { error: "Couldn't read any page of that site — each page's reason is shown in the list below." };
  }
  const pages = stored.filter((n) => n > 0).length;
  const already = others.length - fresh.length;
  const parts = [
    `Read ${pages} page${pages === 1 ? "" : "s"} of this site into ${chunks} chunks`,
    already > 0 ? `${already} already in the vault` : null,
    site.skipped.length > 0 ? `${site.skipped.length} couldn't be read` : null,
  ].filter(Boolean);
  return { notice: `${parts.join(" · ")}.` };
}
