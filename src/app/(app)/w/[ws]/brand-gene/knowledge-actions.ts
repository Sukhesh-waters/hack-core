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
import {
  addClientIdentity,
  listClientIdentities,
  listKnownParties,
  removeClientIdentity,
} from "@/db/queries/client-identities";
import { decideIngest, type IngestRefusal } from "@/lib/ingest/guard";
import { describeIdentity, identityOfUrl, ownershipOf, parseIdentity } from "@/lib/ingest/ownership";
import { normaliseIngestUrl } from "@/lib/ingest/url";

export type IngestState =
  | {
      error?: string;
      notice?: string;
      /** Set when the URL was refused as not the client's own (C7.0). */
      refusal?: IngestRefusal;
    }
  | undefined;

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
  const rawUrl = String(formData.get("url") ?? "");
  const parsed = ingestUrlSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    clientId: formData.get("clientId"),
    url: normaliseIngestUrl(rawUrl) ?? rawUrl,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, clientId } = parsed.data;
  let url = parsed.data.url;
  let wholeSite = formData.get("scope") === "site" && firecrawlConfigured();

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    const client = await getClientById(workspaceId, clientId);
    if (!client) return { error: "Client not found in this workspace." };

    // C7.0 two-layer guard: only the client's own pages enter this vault.
    const [own, known] = await Promise.all([
      listClientIdentities(workspaceId, clientId),
      listKnownParties(workspaceId),
    ]);
    const decision = decideIngest({
      url,
      clientName: client.name,
      own,
      known,
      confirmOwn: formData.get("confirmOwn") === "yes",
    });
    if (decision.action === "refuse") return { error: decision.message, refusal: decision.refusal };
    if (decision.addIdentity) {
      await addClientIdentity({
        workspaceId,
        clientId,
        identity: decision.addIdentity,
        source: "confirmed",
        addedById: user.id,
      });
    }
    url = decision.url;
    // A whole-site read lists a website; a social page has no site to list.
    if (identityOfUrl(url)?.kind !== "domain") wholeSite = false;

    if (!wholeSite) {
      const existing = await listKnowledgeSources(workspaceId, clientId);
      if (existing.some((s) => s.status === "ready" && s.url && normaliseIngestUrl(s.url) === url)) {
        return { notice: "That page is already in the knowledge base. The weekly refresh keeps it current." };
      }
    }
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
    const chunks = chunkText(text.slice(0, MAX_SOURCE_CHARS));
    await storePage(workspaceId, clientId, sourceId, title, chunks);
    return { notice: `Read ${title ?? "the page"} into ${chunks.length} chunk${chunks.length === 1 ? "" : "s"}.` };
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

// ---------------------------------------------------------------------------
// The client's own sites and pages (C7.0) — the list the ingest guard checks.
// ---------------------------------------------------------------------------

export type IdentityState = { error?: string; notice?: string } | undefined;

export async function addOwnIdentityAction(_prev: IdentityState, formData: FormData): Promise<IdentityState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const clientId = String(formData.get("clientId") ?? "");
  const text = String(formData.get("identity") ?? "").trim();
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    const client = await getClientById(workspaceId, clientId);
    if (!client) return { error: "Client not found in this workspace." };
    const identity = parseIdentity(text);
    if (!identity) {
      return { error: "Enter a website (waters.com) or a profile link (linkedin.com/company/waters)." };
    }
    const who = ownershipOf(text, { own: [], known: await listKnownParties(workspaceId) });
    if (who.verdict === "third_party") {
      return { error: `That belongs to ${who.name}, a competitor this workspace watches.` };
    }
    await addClientIdentity({ workspaceId, clientId, identity, source: "confirmed", addedById: user.id });
    revalidatePath(`/w/${workspaceId}/brand-gene`);
    return { notice: `Added ${describeIdentity(identity)}.` };
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}

export async function removeOwnIdentityAction(formData: FormData): Promise<void> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const clientId = String(formData.get("clientId") ?? "");
  const id = String(formData.get("id") ?? "");
  const user = await requireUser();
  await requireMembership(workspaceId, user.id);
  await removeClientIdentity(workspaceId, clientId, id);
  revalidatePath(`/w/${workspaceId}/brand-gene`);
}
