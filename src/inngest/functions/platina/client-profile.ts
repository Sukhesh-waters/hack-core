import { inngest } from "@/inngest/client";
import {
  getBrand,
  listOwnPages,
  saveBrandProfile,
  saveBrandProfileError,
} from "@/db/queries/platina";
import { routeAI } from "@/lib/ai/router";
import { runWithAiCost } from "@/lib/ai/usage-context";
import {
  buildProfilePrompt,
  parseProfile,
  selectProfilePages,
} from "@/lib/platina/profile";
import { broadcastPlatinaSignal } from "@/lib/platina/realtime-server";

/**
 * Builds the client profile from the client's OWN scraped pages. Requested by
 * the audit run right after it stores a client's pages, so a pasted URL becomes
 * visible analysis within seconds of the scrape. It always rebuilds from the
 * freshest pages across all of the client's own sources, so a later run of one
 * source can never overwrite the profile with a partial view.
 *
 * A failure is written onto the client (profile_error) and shown on its page —
 * never a silently empty card.
 */
export const platinaClientProfile = inngest.createFunction(
  {
    id: "platina-client-profile",
    triggers: [{ event: "platina/client.profile.requested" }],
    concurrency: { key: "event.data.workspaceId", limit: 2 },
  },
  async ({ event, step }) => {
    const data = event.data as { workspaceId?: string; brandId?: string };
    if (typeof data.workspaceId !== "string" || typeof data.brandId !== "string") {
      return { skipped: "malformed event" };
    }
    const { workspaceId, brandId } = data;

    const brand = await step.run("brand", () => getBrand(workspaceId, brandId));
    if (!brand || brand.kind !== "own_brand") return { skipped: "not a client" };

    const rows = await step.run("pages", () => listOwnPages(workspaceId, brandId));
    const pages = selectProfilePages(rows.map((r) => ({ ...r, url: r.canonicalUrl ?? r.url })));
    if (pages.length === 0) {
      await step.run("no-pages", () =>
        saveBrandProfileError(workspaceId, brandId, "No pages were collected for this client yet."),
      );
      return { skipped: "no pages" };
    }

    try {
      const raw = await step.run("analyse", () =>
        runWithAiCost({ workspaceId, purpose: "client-profile" }, () =>
          routeAI({
            kind: "chat",
            tier: "fast",
            json: true,
            system:
              "You describe a company strictly from its own website text. Never invent facts.",
            prompt: buildProfilePrompt(brand.name, pages),
          }),
        ),
      );
      const profile = parseProfile(raw);
      await step.run("save", () =>
        saveBrandProfile(workspaceId, brandId, {
          profile,
          sources: pages.map((p) => p.url),
        }),
      );
      await broadcastPlatinaSignal(workspaceId, "audits", brandId);
      return { profiled: brandId, pages: pages.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : "analysis failed";
      await step.run("save-error", () => saveBrandProfileError(workspaceId, brandId, message));
      await broadcastPlatinaSignal(workspaceId, "audits", brandId);
      return { failed: message };
    }
  },
);
