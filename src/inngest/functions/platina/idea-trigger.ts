import { inngest } from "@/inngest/client";
import { latestSuggestionsForSubjectsQuery } from "@/db/queries/platina-learning";
import { listAllWorkspaceIds } from "@/db/queries/workspaces";
import { loadTriggers } from "@/lib/platina/idea-load";
import { runIdeaEngine } from "@/lib/platina/idea-run";

/** A trigger that got ideas this recently is not drafted again. */
const REDRAFT_AFTER_DAYS = 7;

/**
 * Triggered ideation (C8.5 T85.5): every morning, per workspace, the most
 * pressing trigger in today's data that has not had ideas this week gets
 * one idea run (one model call, inside the daily idea cap). Every idea goes
 * into the ledger, so the Learning page shows it with its trace.
 */
export const platinaIdeaTrigger = inngest.createFunction(
  { id: "platina-idea-trigger", triggers: [{ cron: "0 6 * * *" }], concurrency: { limit: 1 } },
  async ({ step }) => {
    const workspaceIds = await step.run("list-workspaces", () => listAllWorkspaceIds());
    const drafted: { workspaceId: string; trigger: string | null; ideas: number; error?: string }[] = [];
    for (const ws of workspaceIds) {
      const r = await step.run(`ideas-${ws}`, async () => {
        const { client, triggers } = await loadTriggers(ws);
        if (!client || triggers.length === 0) return { workspaceId: ws, trigger: null, ideas: 0 };
        const recent = await latestSuggestionsForSubjectsQuery(ws, "idea", triggers.map((t) => t.key));
        const since = Date.now() - REDRAFT_AFTER_DAYS * 86_400_000;
        const fresh = new Set(recent.filter((s) => new Date(s.createdAt).getTime() >= since).map((s) => s.subjectKey));
        const next = triggers.find((t) => !fresh.has(t.key));
        if (!next) return { workspaceId: ws, trigger: null, ideas: 0 };
        try {
          const result = await runIdeaEngine(ws, next.key, () => {});
          return { workspaceId: ws, trigger: next.key, ideas: result.ideas.length };
        } catch (error) {
          // Cap reached, no model available, nothing passed the check: tomorrow tries again.
          return { workspaceId: ws, trigger: next.key, ideas: 0, error: error instanceof Error ? error.message : "failed" };
        }
      });
      drafted.push(r);
    }
    return { workspaces: drafted.length, ideas: drafted.reduce((n, d) => n + d.ideas, 0), drafted };
  },
);
