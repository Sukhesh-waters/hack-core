import { inngest } from "@/inngest/client";
import {
  claimSignal,
  getBrand,
  getPreviousSignalDocument,
  getScanSpec,
  getWorkspaceConfig,
  insertBrainChunk,
  insertFinding,
  insertTranscript,
  markSignalProcessed,
  markSignalSkipped,
  releaseSignal,
} from "@/db/queries/platina";
import { runWithAiCost } from "@/lib/ai/usage-context";
import { ANALYSIS_GLOBAL_CONCURRENCY, ANALYSIS_THROTTLE } from "@/lib/platina/analysis";
import { planAnalysis } from "@/lib/platina/analysis-plan";
import { runContradictionRound } from "@/lib/platina/debate";
import { findingTitleFor } from "@/lib/platina/finding-title";
import { embedText } from "@/lib/platina/embed";
import { findingPathFor, findingUseCaseForSourceKind } from "@/lib/platina/findings";
import { broadcastPlatinaSignal } from "@/lib/platina/realtime-server";

/**
 * Analyses exactly one signal document: debate -> transcript -> finding and
 * Brain chunk -> mark processed. The sweep fans out one event per document
 * (event id = analyze:<signalId>, so a re-dispatch is deduped), and the
 * per-workspace concurrency key stops one busy workspace starving the rest.
 *
 * Idempotency has two layers: the event id, and claimSignal — an atomic
 * unprocessed -> processing flip that only one caller can win, so a replay
 * finds nothing to claim and returns without writing a duplicate finding.
 * A failed analysis releases the claim so the next sweep retries it.
 */
export const platinaSignalAnalyze = inngest.createFunction(
  {
    id: "platina-signal-analyze",
    triggers: [{ event: "platina/signal.analyze" }],
    // A busy workspace cannot starve the rest (keyed), and the whole account
    // stays inside the Gemini rate limit (global + throttle).
    concurrency: [
      { key: "event.data.workspaceId", limit: 4 },
      { limit: ANALYSIS_GLOBAL_CONCURRENCY },
    ],
    throttle: ANALYSIS_THROTTLE,
  },
  async ({ event, step }) => {
    const data = event.data as { workspaceId?: string; signalId?: string };
    if (typeof data.workspaceId !== "string" || typeof data.signalId !== "string") {
      return { skipped: "malformed event" };
    }
    const { workspaceId, signalId } = data;

    const signal = await step.run("claim", () => claimSignal(workspaceId, signalId));
    if (!signal) return { skipped: "already analysed or in progress" };

    try {
      // Who is this page about? One lookup, reused by every step below: the
      // competitor it belongs to, and the client that competitor is watched
      // for. Without it the debate reads an anonymous wall of text (R2).
      const subject = await step.run("subject", async () => {
        if (!signal.scanSpecId) return null;
        const spec = await getScanSpec(workspaceId, signal.scanSpecId);
        const brand = spec?.brandId ? await getBrand(workspaceId, spec.brandId) : null;
        const sourceKind = spec?.targets[0]?.kind ?? null;
        // One shape either way: an unlinked source is honestly nameless, not
        // a different type the callers below have to narrow.
        if (!brand) {
          return { kind: null, brandName: null, clientName: null, sourceKind };
        }
        const parent =
          brand.kind === "competitor" && brand.parentBrandId
            ? await getBrand(workspaceId, brand.parentBrandId)
            : null;
        return {
          kind: brand.kind as string | null,
          brandName: brand.name as string | null,
          clientName: parent?.name ?? null,
          sourceKind,
        };
      });

      // One tested decision (lib/platina/analysis-plan.ts): own-brand page,
      // low-value page, or an analysis input that names the competitor, the
      // client and what changed. A skip here means no provider is ever called.
      const plan = await step.run("plan", () =>
        planAnalysis({
          signal: {
            title: signal.title,
            body: signal.body,
            sourceUrl: signal.sourceUrl,
            canonicalUrl: signal.canonicalUrl,
            sourceKind: signal.sourceKind,
            fetchedAt: signal.fetchedAt,
            metrics: signal.metrics,
          },
          subject,
          loadPrevious: () =>
            getPreviousSignalDocument(
              workspaceId,
              signal.canonicalUrl,
              new Date(signal.fetchedAt),
            ),
        }),
      );

      if (plan.action === "skip") {
        await step.run("processed-skip", () =>
          plan.cause === "own_brand"
            ? markSignalProcessed(workspaceId, signal.id)
            : markSignalSkipped(workspaceId, signal.id, plan.reason),
        );
        return { skipped: plan.reason };
      }

      const config = await step.run("config", () => getWorkspaceConfig(workspaceId));
      const floors = config
        ? {
            contestedFloor: config.contestedFloor,
            qualifiedFloor: config.qualifiedFloor,
          }
        : undefined;

      // Inside a cost context so the daily AI cap applies and provider
      // failures are attributed to this workspace.
      const result = await step.run("debate", () =>
        runWithAiCost({ workspaceId, purpose: "signal-analysis" }, () =>
          runContradictionRound(plan.input, floors),
        ),
      );

      const transcriptId = await step.run("transcript", () =>
        insertTranscript({
          workspaceId,
          signalIds: [signal.id],
          proposerClaim: result.claim.text,
          challengerAttack: result.attack.text,
          score: result.result.score,
          state: result.result.state,
          strongestObjection: result.result.caveat,
        }),
      );
      // The proposer is allowed to say a page holds no move. Recording that
      // keeps the findings list about moves instead of about pages — and the
      // transcript above means the judgement stays auditable.
      if (result.nothingNew && !plan.changed) {
        await step.run("processed-nothing-new", () =>
          markSignalSkipped(
            workspaceId,
            signal.id,
            "Read, but there was no new move on this page.",
          ),
        );
        return {
          analysed: signal.id,
          state: result.result.state,
          transcriptId,
          nothingNew: true,
        };
      }

      const path = findingPathFor(result.result.state);

      let brainChunkId: string | null = null;
      if (path.brainChunk) {
        const content = result.result.caveat
          ? `${result.claim.text}\nCaveat: ${result.result.caveat}`
          : result.claim.text;
        // Embed at write time; a router outage stores the chunk without a
        // vector rather than blocking the finding.
        const embedding = await step.run("embed", () =>
          runWithAiCost({ workspaceId, purpose: "signal-analysis" }, () =>
            embedText(content),
          ),
        );
        brainChunkId = await step.run("brain", () =>
          insertBrainChunk({
            workspaceId,
            content,
            confidence: result.result.score,
            agreementState: result.result.state,
            sourceSignalIds: [signal.id],
            generation: 0,
            transcriptId,
            embedding: embedding ?? undefined,
          }),
        );
      }

      if (path.finding) {
        const useCase = findingUseCaseForSourceKind(
          signal.sourceKind ?? subject?.sourceKind ?? undefined,
        );
        await step.run("finding", () =>
          insertFinding({
            workspaceId,
            signalDocumentId: signal.id,
            transcriptId,
            brainChunkId,
            useCase,
            // The move, not the page's HTML title (R2).
            title: findingTitleFor({
              headline: result.headline,
              competitorName: subject?.brandName ?? null,
              claimText: result.claim.text,
              pageTitle: signal.title,
            }),
            summary: result.claim.text,
            strongestObjection: result.result.caveat ?? result.attack.text,
            status: path.finding === "needs_decision" ? "needs_decision" : "new",
          }),
        );
        await broadcastPlatinaSignal(workspaceId, "findings");
      }

      await step.run("processed", () => markSignalProcessed(workspaceId, signal.id));
      return { analysed: signal.id, state: result.result.state };
    } catch (error) {
      await step.run("release", () => releaseSignal(workspaceId, signal.id));
      throw error;
    }
  },
);
