import { inngest } from "@/inngest/client";
import {
  addFirstPassPages,
  getAuditRun,
  markTargetsRendered,
  rememberPickedPages,
  clearTargetBackfill,
  getBrand,
  getScanSpec,
  getWorkspaceConfig,
  getWorkspacePagesToday,
  insertSignalDocuments,
  recordFetchOutcome,
  transitionAuditRun,
} from "@/db/queries/platina";
import { runApprovedScan } from "@/lib/platina/fetch/registry";
import {
  DEFAULT_FIRST_PASS_PAGES,
  DEFAULT_WORKSPACE_DAY_CAP,
  budgetForRun,
  firstPassRemaining,
} from "@/lib/platina/fetch/budget";
import {
  backoffInterval,
  specPagesRemaining,
  tightenInterval,
  workspacePagesRemaining,
} from "@/lib/platina/fetch/schedule";
import { divergenceStage, ideationStage } from "@/lib/platina/stages/wire";
import { registerWatersAdapter } from "@/lib/platina/fetch/waters";
import {
  executeAuditRun,
  type AuditRunRecord,
} from "@/lib/platina/orchestrator";
import { broadcastPlatinaSignal } from "@/lib/platina/realtime-server";
import type { RunStatus } from "@/lib/platina/run-status";

registerWatersAdapter();

/**
 * Durable audit-run worker. The orchestrator owns the state machine; every
 * transition is a guarded DB write followed by a post-commit broadcast. The
 * whole execution is one Inngest step because it is idempotent per run id —
 * a retry replays into guarded no-ops, never duplicate writes.
 */
export const platinaAuditRun = inngest.createFunction(
  {
    id: "platina-audit-run",
    triggers: [{ event: "platina/audit-run.requested" }],
    // Every run is a paid Apify call and the account has one memory pool, so
    // runs are limited account-wide. A first pass of many sources queues here
    // instead of stampeding the actor API (which answers 402).
    concurrency: { limit: 2 },
  },
  async ({ event, step }) => {
    const data = event.data as { runId?: string; workspaceId?: string };
    if (typeof data.runId !== "string" || typeof data.workspaceId !== "string") {
      return { skipped: "malformed event" };
    }
    const { runId, workspaceId } = data;

    return step.run(`execute-${runId}`, async () => {
      // Which client is this run about? Resolved once and reused by the
      // analysis stages, so they compare this client's standard with this
      // client's competitors and nobody else's (R3).
      let runBrandId: string | null | undefined;
      const brandOfRun = async (ws: string, run: AuditRunRecord) => {
        if (runBrandId === undefined) {
          const spec = run.specId ? await getScanSpec(ws, run.specId) : null;
          runBrandId = spec?.brandId ?? null;
        }
        return runBrandId;
      };

      const outcome = await executeAuditRun(
        {
          loadRun: async (ws, id) => {
            const run = await getAuditRun(ws, id);
            if (!run) return null;
            return {
              id: run.id,
              workspaceId: run.workspaceId,
              specId: run.specId,
              status: run.status as RunStatus,
              configSnapshot: run.configSnapshot,
              counters: run.counters,
            } satisfies AuditRunRecord;
          },
          transition: (input) => transitionAuditRun(input),
          runFetchStage: async (ws, run) => {
            if (!run.specId) throw new Error("run has no audit source");
            const spec = await getScanSpec(ws, run.specId);
            if (!spec) throw new Error("audit source not found");
            if (spec.status !== "approved") {
              throw new Error("audit source is not approved");
            }
            // Spend control (R7). A client's one-time first-pass allowance is
            // spent first and bypasses the daily cap, so a new client is
            // readable the same afternoon; after that the daily cap applies.
            const config = await getWorkspaceConfig(ws);
            const today = new Date().toISOString().slice(0, 10);
            const brand = spec.brandId ? await getBrand(ws, spec.brandId) : null;
            const decision = budgetForRun({
              specRemaining: specPagesRemaining(spec),
              workspaceRemaining: workspacePagesRemaining(
                await getWorkspacePagesToday(ws, today),
                config?.dailyActorCallCap ?? DEFAULT_WORKSPACE_DAY_CAP,
              ),
              firstPassRemaining: brand
                ? firstPassRemaining(
                    brand.firstPassPagesUsed,
                    config?.firstPassPageAllowance ?? DEFAULT_FIRST_PASS_PAGES,
                  )
                : 0,
            });
            if (decision.pages === 0) throw new Error(decision.reason);
            const pageBudget = decision.pages;
            const outcome = await runApprovedScan({
              id: spec.id,
              workspaceId: spec.workspaceId,
              status: spec.status,
              targets: spec.targets,
              pageBudget,
            });
            const inserted = await insertSignalDocuments(
              ws,
              spec.id,
              outcome.docs,
            );
            // Charge the first pass only for what was really collected, and
            // only while that purse is the one paying (R7).
            if (decision.charge === "first_pass" && spec.brandId) {
              await addFirstPassPages(ws, spec.brandId, outcome.pages ?? 0);
            }
            // A target that only gave up its content to a browser is marked as
            // such, so the next tick skips the pointless plain fetch (R9).
            if (outcome.escalated && outcome.escalated.length > 0) {
              await markTargetsRendered(
                ws,
                spec.id,
                outcome.escalated.map((e) => e.target),
              );
            }
            // A one-time backfill that collected is not repeated next week.
            if (spec.targets.some((t) => t.backfill)) {
              const collected = new Set(outcome.docs.map((d) => d.sourceUrl));
              await clearTargetBackfill(
                ws,
                spec.id,
                spec.targets.filter((t) => t.backfill && collected.has(t.value)).map((t) => t.value),
              );
            }
            // Pages the site picker chose are remembered for a week (C1).
            if (outcome.picked && outcome.picked.length > 0) {
              await rememberPickedPages(ws, spec.id, outcome.picked);
            }
            // New posts or ads for a client or a competitor: re-measure the
            // client's interest signals (C3). Debounced per client.
            if (
              spec.brandId &&
              inserted > 0 &&
              outcome.docs.some((d) => d.sourceKind === "social_posts" || d.sourceKind === "ad_library")
            ) {
              try {
                const owner = await getBrand(ws, spec.brandId);
                const clientId = owner?.kind === "own_brand" ? owner.id : owner?.parentBrandId;
                if (clientId) {
                  await inngest.send({
                    name: "platina/interest.extract.requested",
                    data: { workspaceId: ws, brandId: clientId },
                  });
                }
              } catch {
                // The documents are stored; the daily sweep measures them.
              }
            }
            // New conference pages or posts: read events (C4). Debounced per workspace.
            if (
              inserted > 0 &&
              outcome.docs.some((d) => d.sourceKind === "conference" || d.sourceKind === "social_posts")
            ) {
              try {
                await inngest.send({ name: "platina/events.extract.requested", data: { workspaceId: ws } });
              } catch {
                // The documents are stored; the daily sweep reads them.
              }
            }
            // A client's own pages feed its profile (not the competitor debate).
            if (spec.brandId && outcome.docs.length > 0) {
              try {
                const brand = await getBrand(ws, spec.brandId);
                if (brand?.kind === "own_brand" && (inserted > 0 || !brand.profile)) {
                  await inngest.send({
                    name: "platina/client.profile.requested",
                    data: { workspaceId: ws, brandId: brand.id },
                  });
                }
              } catch {
                // The pages are stored; the profile can be rebuilt on the next run.
              }
            }
            return {
              fetched: outcome.docs.length,
              pages: outcome.pages,
              inserted,
              failures: outcome.failures.map(
                (f) => `${f.target} (${f.error})`,
              ),
              // A successful rendered retry is a NOTE, never a failure: it
              // must not degrade a run that actually collected its content.
              notes: [
                ...(outcome.escalated ?? []).map(
                  (e) => `${e.target}: now read with a browser (${e.reason})`,
                ),
                // Firecrawl could not read it, Apify did: collected, so a note.
                ...(outcome.fallbacks ?? []).map(
                  (f) => `${f.target}: read with Apify after Firecrawl failed (${f.reason})`,
                ),
                ...(outcome.skippedPages ?? []).map(
                  (p) => `${p.url}: not read (${p.reason})`,
                ),
                // Searched and found nothing: an answer, recorded as a note.
                ...(outcome.empty ?? []).map((e) => `${e.target}: ${e.reason}`),
              ],
            };
          },
          runDivergenceStage: async (ws, run) =>
            divergenceStage(ws, await brandOfRun(ws, run)),
          runIdeationStage: async (ws, run) =>
            ideationStage(ws, await brandOfRun(ws, run)),
          dispatchContradiction: async (ws) => {
            await inngest.send({
              name: "platina/contradict.requested",
              data: { workspaceId: ws },
            });
          },
          recordSpecOutcome: (ws, specId, outcome) =>
            recordFetchOutcome(ws, specId, outcome, {
              tighten: tightenInterval,
              backoff: backoffInterval,
            }),
          broadcast: (ws, id) => broadcastPlatinaSignal(ws, "audits", id),
        },
        workspaceId,
        runId,
      );
      return outcome;
    });
  },
);
