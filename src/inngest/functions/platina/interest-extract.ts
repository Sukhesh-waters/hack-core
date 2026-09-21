import { inngest } from "@/inngest/client";
import {
  getBrand,
  insertInterestSignals,
  listBrands,
  listCompetitorsOf,
  listInterestSignals,
  listInterestSourceDocs,
} from "@/db/queries/platina";
import { listAllWorkspaceIds } from "@/db/queries/workspaces";
import { extractInterestForClient, type InterestExtractDeps } from "@/lib/platina/interest-extract";
import { assignTopics } from "@/lib/platina/interest-topics";
import { syncClientInsights } from "@/lib/platina/market-insight-sync";

const deps: InterestExtractDeps = {
  getClient: async (ws, id) => {
    const brand = await getBrand(ws, id);
    return brand ? { id: brand.id, name: brand.name, kind: brand.kind, profile: brand.profile ?? null } : null;
  },
  listCompetitorIds: async (ws, clientId) => (await listCompetitorsOf(ws, clientId)).map((b) => b.id),
  listDocs: (ws, brandIds, since) => listInterestSourceDocs(ws, brandIds, since),
  assign: (texts, topics) => assignTopics(texts, topics),
  insert: (rows) => insertInterestSignals(rows),
  listKnownTopics: async (w, ids, since) => {
    const counts = new Map<string, number>();
    for (const s of await listInterestSignals(w, ids, since)) counts.set(s.topic, (counts.get(s.topic) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([topic]) => topic);
  },
};

/**
 * Interest extraction (campaign intelligence C3). Runs for one client after
 * its (or a competitor's) posts or ads are collected, and as a daily sweep.
 * Idempotent: the measurement key makes a re-run a no-op.
 */
export const platinaInterestExtract = inngest.createFunction(
  {
    id: "platina-interest-extract",
    triggers: [{ event: "platina/interest.extract.requested" }, { cron: "30 4 * * *" }],
    // One pass per client at a time; a burst of collections collapses.
    concurrency: { key: "event.data.brandId", limit: 1 },
    debounce: { key: "event.data.brandId", period: "2m" },
  },
  async ({ event, step }) => {
    const data = (event?.data ?? {}) as { workspaceId?: string; brandId?: string };
    if (typeof data.workspaceId === "string" && typeof data.brandId === "string") {
      const extracted = await step.run(`extract-${data.brandId}`, () =>
        extractInterestForClient(deps, { workspaceId: data.workspaceId!, clientId: data.brandId! }),
      );
      // Measured insights into the Brain, so plans and ideation retrieve them (C5).
      const insights = await step.run(`insights-${data.brandId}`, () =>
        syncClientInsights(data.workspaceId!, data.brandId!),
      );
      return { extracted, insights };
    }
    // Daily sweep: every client in every workspace.
    const workspaceIds = await step.run("list-workspaces", () => listAllWorkspaceIds());
    let done = 0;
    for (const ws of workspaceIds) {
      const clients = await step.run(`clients-${ws}`, async () =>
        (await listBrands(ws)).filter((b) => b.kind === "own_brand").map((b) => b.id),
      );
      for (const clientId of clients) {
        const result = await step.run(`extract-${clientId}`, () =>
          extractInterestForClient(deps, { workspaceId: ws, clientId }),
        );
        if (result.status === "done") done += 1;
        await step.run(`insights-${clientId}`, () => syncClientInsights(ws, clientId));
      }
    }
    return { clients: done };
  },
);
