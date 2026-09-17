import { inngest } from "@/inngest/client";
import { listAllWorkspaceIds } from "@/db/queries/workspaces";
import { listApprovedBrandSources } from "@/db/queries/platina";
import { runBrandExtraction } from "@/lib/platina/brand-extract";
import { fetchViaWaters, registerWatersAdapter } from "@/lib/platina/fetch/waters";

registerWatersAdapter();

/**
 * Daily brand-source refresh (Slice 8). Approved URL sources re-fetch through
 * the Waters adapter (consented first-party content, Plane A). A changed
 * content hash re-chunks and re-embeds; an unchanged source produces no
 * duplicate chunks — only its freshness timestamp moves.
 */
export const platinaBrandRefresh = inngest.createFunction(
  {
    id: "platina-brand-refresh",
    triggers: [{ cron: "0 3 * * *" }],
  },
  async ({ step }) => {
    const workspaceIds = await step.run("list-workspaces", () =>
      listAllWorkspaceIds(),
    );
    let refreshed = 0;
    let unchanged = 0;
    let failed = 0;
    for (const workspaceId of workspaceIds) {
      const sources = await step.run(`sources-${workspaceId}`, () =>
        listApprovedBrandSources(workspaceId),
      );
      for (const source of sources) {
        if (!source.url) continue; // pasted sources refresh by re-confirming text
        const result = await step.run(`refresh-${source.id}`, async () => {
          try {
            const outcome = await fetchViaWaters({
              id: source.id,
              workspaceId,
              status: "approved",
              targets: [{ kind: "competitor_site", value: source.url! }],
            });
            const content = outcome.docs.map((d) => d.body).join("\n\n");
            if (!content) return { ok: false as const };
            const extraction = await runBrandExtraction(source, content);
            return { ok: true as const, changed: extraction.changed };
          } catch {
            return { ok: false as const };
          }
        });
        if (!result.ok) failed += 1;
        else if (result.changed) refreshed += 1;
        else unchanged += 1;
      }
    }
    return { refreshed, unchanged, failed };
  },
);
