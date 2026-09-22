/**
 * Production dependencies for the own-site pass (C6 L1). Shared by the
 * Inngest job and scripts/own-site.ts so both run the same code.
 */
import { createHash } from "node:crypto";
import { getBrand, getWorkspaceConfig } from "@/db/queries/platina";
import {
  insertFirstPartyChunks,
  insertOwnSitePages,
  listOwnSitePages,
  markOwnSitePagesGone,
  recordOwnSiteMap,
  supersedeFirstPartyChunks,
  updateOwnSitePage,
} from "@/db/queries/platina-learning";
import { mapSite, scrapeWithFirecrawl } from "@/lib/scrape/firecrawl";
import { embedTexts } from "@/lib/platina/embed";
import { probeSource } from "@/lib/platina/fetch/probe";
import { headProbeFetch } from "@/lib/platina/fetch/probe-fetch";
import type { OwnSiteDeps } from "@/lib/platina/own-site-run";

/** Firecrawl may serve a copy this fresh; older and it reads the live page. */
const SCRAPE_MAX_AGE_MS = 10 * 60_000;

/** The real side effects behind runOwnSitePass: database, Firecrawl, header probe, embeddings. */
export const ownSiteDeps: OwnSiteDeps = {
  getClient: async (ws, id) => {
    const brand = await getBrand(ws, id);
    return brand
      ? { id: brand.id, kind: brand.kind, homepageUrl: brand.homepageUrl, ownSiteMappedAt: brand.ownSiteMappedAt }
      : null;
  },
  getLimits: async (ws) => {
    const config = await getWorkspaceConfig(ws);
    return { dailyPages: config?.ownSiteDailyPages ?? 50, maxPages: config?.ownSiteMaxPages ?? 300 };
  },
  listPages: (ws, brandId) => listOwnSitePages(ws, brandId),
  map: (url) => mapSite(url),
  insertPages: insertOwnSitePages,
  updatePage: updateOwnSitePage,
  markGone: markOwnSitePagesGone,
  recordMap: recordOwnSiteMap,
  probe: (url, prior) => probeSource(url, prior, headProbeFetch),
  scrape: (url) => scrapeWithFirecrawl(url, { maxAgeMs: SCRAPE_MAX_AGE_MS }),
  embed: embedTexts,
  hash: (text) => createHash("sha256").update(text).digest("hex"),
  writeChunks: async ({ workspaceId, brandId, page, chunks }) => {
    // Insert first, then retire the old copy excluding the new ids: a failure
    // in between leaves the page's previous knowledge in place.
    const ids = await insertFirstPartyChunks(
      chunks.map((c, index) => ({
        workspaceId,
        brandId,
        kind: "own_site" as const,
        sourceRef: page.id,
        sourceUrl: page.url,
        title: page.title,
        content: c.content,
        chunkIndex: index,
        ...(c.embedding ? { embedding: c.embedding } : {}),
      })),
    );
    await supersedeFirstPartyChunks(workspaceId, [page.id], ids);
  },
  retireChunks: (ws, pageIds) => supersedeFirstPartyChunks(ws, pageIds),
  now: () => new Date(),
};
