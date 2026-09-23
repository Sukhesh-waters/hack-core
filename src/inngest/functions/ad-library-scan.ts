import { inngest } from "@/inngest/client";
import { db } from "@/db";
import { patternAds } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { PatternAdLibraryItem } from "@/lib/connectors/apify-actors";

/**
 * Ad Library scan sweep. Runs every 6 hours (ads change less frequently
 * than posts) or on-demand via the ads/scan.requested event.
 *
 * Constitution: results land ONLY in pattern_ads (score-free, public layer).
 * Degradation: no APIFY_TOKEN → skip cleanly; actor failure → log and continue.
 */
export const adLibraryScan = inngest.createFunction(
  {
    id: "ad-library-scan",
    triggers: [
      { cron: "0 */6 * * *" },
      { event: "ads/scan.requested" },
    ],
  },
  async ({ event, step }) => {
    const data = (event as { data?: Record<string, unknown> } | undefined)
      ?.data;
    const requestedWorkspace =
      typeof data?.workspaceId === "string" ? data.workspaceId : null;
    const searchTerms =
      Array.isArray(data?.searchTerms) ? data.searchTerms as string[] : [];

    if (!requestedWorkspace || searchTerms.length === 0) {
      return { skipped: "no workspace or search terms provided" };
    }

    const token = process.env.APIFY_TOKEN;
    if (!token) {
      return { skipped: "APIFY_TOKEN not set" };
    }

    const inserted = await step.run("fetch-and-store-ads", async () => {
      // Dynamic import to keep the function tree-shakeable in non-scraping contexts
      const { adLibraryActor, resolveActorSlug } = await import(
        "@/lib/connectors/apify-actors"
      );
      const { isCallAllowed, recordSuccess, recordFailure } = await import(
        "@/lib/connectors/circuit-breaker"
      );

      if (!isCallAllowed("ad_library")) {
        return { count: 0, error: "circuit breaker open for ad_library" };
      }

      const slug = resolveActorSlug("ad_library");
      const input = adLibraryActor.buildInput({
        searchTerms,
        resultsLimit: 50,
      });

      try {
        const response = await fetch(
          `https://api.apify.com/v2/acts/${slug}/run-sync-get-dataset-items`,
          {
            method: "POST",
            // The token travels in a header, never the URL (URLs end up in logs).
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify(input),
          },
        );

        if (!response.ok) {
          recordFailure("ad_library");
          return { count: 0, error: `Apify returned ${response.status}` };
        }

        const rawItems = await response.json();
        if (!Array.isArray(rawItems)) {
          recordFailure("ad_library");
          return { count: 0, error: "unexpected Apify payload" };
        }

        const items = adLibraryActor.mapOutput(rawItems) as PatternAdLibraryItem[];
        recordSuccess("ad_library");

        if (items.length === 0) return { count: 0 };

        // Dedupe by externalId against existing rows
        const existingIds = new Set(
          (
            await db
              .select({ externalId: patternAds.externalId })
              .from(patternAds)
              .where(eq(patternAds.workspaceId, requestedWorkspace))
          )
            .map((r) => r.externalId)
            .filter(Boolean) as string[],
        );

        const fresh = items.filter(
          (i) => !i.externalId || !existingIds.has(i.externalId),
        );

        if (fresh.length > 0) {
          await db.insert(patternAds).values(
            fresh.map((item) => ({
              workspaceId: requestedWorkspace,
              pageHandle: item.pageHandle,
              externalId: item.externalId,
              adBody: item.adBody,
              adFormat: item.adFormat,
              targetAudience: item.targetAudience,
              postedAt: item.postedAt,
              raw: item.raw,
            })),
          );
        }

        return { count: fresh.length };
      } catch (error) {
        recordFailure("ad_library");
        return {
          count: 0,
          error: error instanceof Error ? error.message : "unknown",
        };
      }
    });

    return inserted;
  },
);
