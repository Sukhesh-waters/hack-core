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
import { buildNumberedAnalysisInput } from "@/lib/platina/analysis-input";
import { analysisWrites, type AnalysisWriteContext, type AnalysisWritesV2Input } from "@/lib/platina/analysis-writes";
import { modeOf } from "@/lib/platina/brain-modes";
import { recordBrainEvent } from "@/lib/platina/brain-telemetry";
import { ANALYSIS_PROMPT_VERSION, runContradictionRound, runInterrogationRound } from "@/lib/platina/debate";
import { embedText } from "@/lib/platina/embed";
import { INTERROGATION_PROMPT_VERSION } from "@/lib/platina/interrogation";
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
 *
 * B0 (metacognitive Brain): `analysisWrites` (lib/platina/analysis-writes.ts)
 * now makes the WHAT-to-write decision this file used to make inline; the
 * decision is unchanged (proven by brain-legacy-equivalence.test.ts), and
 * this file still issues every DB write itself. Telemetry
 * (`recordBrainEvent`) is added at every exit, each folded into the
 * step.run that already performs that exit's DB write rather than given a
 * step of its own: Inngest memoizes a completed step.run and never re-runs
 * its callback on replay, so sharing the step is what stops a replay from
 * recording the same funnel event twice. `recordBrainEvent` itself never
 * throws, so it cannot turn a successful write into a failed step.
 *
 * B1: `modeOf(config, "interrogation")` forks the whole debate+write path.
 * "off" below is the exact B0 code, untouched. "shadow"/"on" runs the v2
 * interrogation round (debate.ts runInterrogationRound) instead of the v1
 * one — same one proposer + one challenger call, not an extra one — and
 * `analysisWrites`'s 4th (`v2`) argument layers in the falsifier/kind/etc.
 * fields and the mode="on" "untestable" skip (plan §5 B1).
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

      // The same context `findingTitleFor`/`findingUseCaseForSourceKind` used
      // inline before this slice — now threaded through `analysisWrites`.
      const writeContext: AnalysisWriteContext = {
        competitorName: subject?.brandName ?? null,
        pageTitle: signal.title,
        sourceKind: signal.sourceKind ?? subject?.sourceKind ?? undefined,
      };

      if (plan.action === "skip") {
        const writes = analysisWrites(plan, undefined, writeContext);
        await step.run("processed-skip", async () => {
          if (writes.skip) {
            await markSignalSkipped(workspaceId, signal.id, writes.skip.reason, writes.skip.cause);
          } else {
            await markSignalProcessed(workspaceId, signal.id);
          }
          await recordBrainEvent({
            workspaceId,
            stage: "analysis",
            decision: plan.cause,
            subjectId: signal.id,
            promptVersion: ANALYSIS_PROMPT_VERSION,
            detail: { sourceKind: writeContext.sourceKind ?? null },
          });
        });
        return { skipped: plan.reason };
      }

      const config = await step.run("config", () => getWorkspaceConfig(workspaceId));
      const floors = config
        ? {
            contestedFloor: config.contestedFloor,
            qualifiedFloor: config.qualifiedFloor,
          }
        : undefined;
      // B1: everything below forks on this. "off" is the untouched block
      // immediately following — same calls, same shape, same return values
      // as before this slice (proven by brain-legacy-equivalence.test.ts for
      // the pure decision; this fork is what keeps it true in production).
      const mode = modeOf(config, "interrogation");

      if (mode === "off") {
        // Inside a cost context so the daily AI cap applies and provider
        // failures are attributed to this workspace.
        const result = await step.run("debate", () =>
          runWithAiCost({ workspaceId, purpose: "signal-analysis" }, () =>
            runContradictionRound(plan.input, floors),
          ),
        );

        const writes = analysisWrites(plan, result, writeContext);

        const transcriptId = await step.run("transcript", () =>
          insertTranscript({
            workspaceId,
            signalIds: [signal.id],
            ...writes.transcript!,
            // B0 provenance: which provider/model answered on each side, and
            // the prompt version — the before-number for agreement-by-model
            // and the B2 blind-challenger A/B. `blinded` is false until B2.
            proposerProvider: result.providers.proposer,
            proposerModel: result.models.proposer,
            challengerProvider: result.providers.challenger,
            challengerModel: result.models.challenger,
            promptVersion: ANALYSIS_PROMPT_VERSION,
            blinded: false,
            objected: result.objected,
          }),
        );

        // The proposer is allowed to say a page holds no move. Recording that
        // keeps the findings list about moves instead of about pages — and the
        // transcript above means the judgement stays auditable.
        if (writes.skip) {
          await step.run("processed-nothing-new", async () => {
            await markSignalSkipped(workspaceId, signal.id, writes.skip!.reason, writes.skip!.cause);
            await recordBrainEvent({
              workspaceId,
              stage: "analysis",
              decision: "nothing_new",
              subjectId: signal.id,
              promptVersion: ANALYSIS_PROMPT_VERSION,
              detail: { state: result.result.state, changed: plan.changed, providers: result.providers },
            });
          });
          return {
            analysed: signal.id,
            state: result.result.state,
            transcriptId,
            nothingNew: true,
          };
        }

        let brainChunkId: string | null = null;
        if (writes.brainChunk) {
          // Embed at write time; a router outage stores the chunk without a
          // vector rather than blocking the finding.
          const embedding = await step.run("embed", () =>
            runWithAiCost({ workspaceId, purpose: "signal-analysis" }, () =>
              embedText(writes.brainChunk!.content),
            ),
          );
          brainChunkId = await step.run("brain", () =>
            insertBrainChunk({
              workspaceId,
              content: writes.brainChunk!.content,
              confidence: writes.brainChunk!.confidence,
              agreementState: writes.brainChunk!.agreementState,
              generation: writes.brainChunk!.generation,
              sourceSignalIds: [signal.id],
              transcriptId,
              embedding: embedding ?? undefined,
            }),
          );
        }

        if (writes.finding) {
          await step.run("finding", () =>
            insertFinding({
              workspaceId,
              signalDocumentId: signal.id,
              transcriptId,
              brainChunkId,
              useCase: writes.finding!.useCase,
              // The move, not the page's HTML title (R2).
              title: writes.finding!.title,
              summary: writes.finding!.summary,
              strongestObjection: writes.finding!.strongestObjection,
              status: writes.finding!.status,
            }),
          );
          await broadcastPlatinaSignal(workspaceId, "findings");
        }

        await step.run("processed", async () => {
          await markSignalProcessed(workspaceId, signal.id);
          await recordBrainEvent({
            workspaceId,
            stage: "analysis",
            decision: "analysed",
            subjectId: signal.id,
            promptVersion: ANALYSIS_PROMPT_VERSION,
            detail: { state: result.result.state, changed: plan.changed, providers: result.providers },
          });
        });
        return { analysed: signal.id, state: result.result.state };
      }

      // mode shadow | on (plan §5 B1). Same one proposer + one challenger
      // call as "off" — the v2 prompt and schema REPLACE the v1 round rather
      // than running beside it, which is why this costs nothing extra
      // (plan §2.1: "Interrogation … none (same one call)").
      // planAnalysis always sets `parts` once action === "analyse"; it is
      // optional on the type only so hand-built test fixtures type-check.
      const numbered = buildNumberedAnalysisInput(plan.parts!);
      // "brand" is checked against the two names this job already resolved
      // (subject step, above) — no extra query. "topic" has no closed
      // registry in this workspace (interest.ts topics are free-text labels,
      // not a managed list), so any non-empty topic resolves.
      const resolvesSubjectKey = (key: "brand" | "topic" | "creativeId" | "eventId", value: string): boolean => {
        if (key === "topic") return value.trim().length > 0;
        if (key === "brand") {
          const known = [subject?.brandName, subject?.clientName].filter((n): n is string => Boolean(n));
          return known.some((n) => n.toLowerCase() === value.trim().toLowerCase());
        }
        return false;
      };

      const result = await step.run("debate", () =>
        runWithAiCost({ workspaceId, purpose: "signal-analysis" }, () =>
          runInterrogationRound(numbered, floors, { resolvesSubjectKey }),
        ),
      );

      const v2: AnalysisWritesV2Input = {
        mode,
        interrogation: result.interrogation,
        parsed: result.parsed,
        signalDocumentId: signal.id,
        now: new Date(),
        promptVersion: INTERROGATION_PROMPT_VERSION,
        writtenBy: "interrogation-v1",
      };
      const writes = analysisWrites(plan, result, writeContext, v2);

      const transcriptId = await step.run("transcript", () =>
        insertTranscript({
          workspaceId,
          signalIds: [signal.id],
          ...writes.transcript!,
          proposerProvider: result.providers.proposer,
          proposerModel: result.models.proposer,
          challengerProvider: result.providers.challenger,
          challengerModel: result.models.challenger,
          // B1: the prompt actually used on this document, in shadow or on.
          promptVersion: INTERROGATION_PROMPT_VERSION,
          blinded: false,
          objected: result.objected,
        }),
      );

      if (writes.skip) {
        // Either "nothing new" (interrogation was valid; same meaning as
        // mode="off") or, mode="on" only, "untestable" (analysisWrites's v2
        // branch — invalid interrogation, no Brain write, no finding).
        await step.run("processed-skip-v2", async () => {
          await markSignalSkipped(workspaceId, signal.id, writes.skip!.reason, writes.skip!.cause);
          await recordBrainEvent({
            workspaceId,
            stage: "analysis",
            decision: writes.skip!.cause === "untestable" ? "untestable" : "nothing_new",
            subjectId: signal.id,
            promptVersion: INTERROGATION_PROMPT_VERSION,
            detail: writes.skip!.cause === "untestable"
              ? { reason: writes.skip!.reason, mode }
              : { state: result.result.state, changed: plan.changed, providers: result.providers },
          });
        });
        return {
          analysed: signal.id,
          state: result.result.state,
          transcriptId,
          nothingNew: writes.skip.cause !== "untestable",
        };
      }

      let brainChunkId: string | null = null;
      if (writes.brainChunk) {
        const embedding = await step.run("embed", () =>
          runWithAiCost({ workspaceId, purpose: "signal-analysis" }, () =>
            embedText(writes.brainChunk!.content),
          ),
        );
        brainChunkId = await step.run("brain", async () => {
          const id = await insertBrainChunk({
            workspaceId,
            content: writes.brainChunk!.content,
            confidence: writes.brainChunk!.confidence,
            agreementState: writes.brainChunk!.agreementState,
            generation: writes.brainChunk!.generation,
            sourceSignalIds: [signal.id],
            transcriptId,
            embedding: embedding ?? undefined,
            kind: writes.brainChunk!.kind,
            mechanism: writes.brainChunk!.mechanism,
            evidenceRefs: writes.brainChunk!.evidenceRefs,
            falsifier: writes.brainChunk!.falsifier,
            subjectKey: writes.brainChunk!.subjectKey,
            direction: writes.brainChunk!.direction,
            gradeState: writes.brainChunk!.gradeState,
            dueAt: writes.brainChunk!.dueAt,
            promptVersion: writes.brainChunk!.promptVersion,
            writtenBy: writes.brainChunk!.writtenBy,
          });
          // Shadow only reaches here with an invalid interrogation (mode="on"
          // already returned above via writes.skip) — co-located with the
          // write it describes, same replay-safety reasoning as every other
          // telemetry call in this file.
          if (!result.interrogation.ok) {
            await recordBrainEvent({
              workspaceId,
              stage: "analysis",
              decision: "untestable",
              subjectId: signal.id,
              promptVersion: INTERROGATION_PROMPT_VERSION,
              detail: { reason: result.interrogation.reason, mode, gradeState: "insufficient" },
            });
          }
          return id;
        });
        // V9: a claim entering the Brain refreshes any open plan page on the
        // same realtime scope findings already use (B5 reuses it to announce
        // a refutation).
        if (writes.brainChunk.kind === "claim") {
          await broadcastPlatinaSignal(workspaceId, "insights");
        }
      }

      if (writes.finding) {
        await step.run("finding", () =>
          insertFinding({
            workspaceId,
            signalDocumentId: signal.id,
            transcriptId,
            brainChunkId,
            useCase: writes.finding!.useCase,
            title: writes.finding!.title,
            summary: writes.finding!.summary,
            strongestObjection: writes.finding!.strongestObjection,
            status: writes.finding!.status,
          }),
        );
        await broadcastPlatinaSignal(workspaceId, "findings");
      }

      await step.run("processed", async () => {
        await markSignalProcessed(workspaceId, signal.id);
        // Shadow, invalid, but no brainChunk earned (e.g. a contested/refuted
        // debate state) — nowhere else logs "untestable" for this document.
        if (!result.interrogation.ok && !writes.brainChunk) {
          await recordBrainEvent({
            workspaceId,
            stage: "analysis",
            decision: "untestable",
            subjectId: signal.id,
            promptVersion: INTERROGATION_PROMPT_VERSION,
            detail: { reason: result.interrogation.reason, mode },
          });
        }
        await recordBrainEvent({
          workspaceId,
          stage: "analysis",
          decision: "analysed",
          subjectId: signal.id,
          promptVersion: INTERROGATION_PROMPT_VERSION,
          detail: { state: result.result.state, changed: plan.changed, providers: result.providers },
        });
      });
      return { analysed: signal.id, state: result.result.state };
    } catch (error) {
      await step.run("release", () => releaseSignal(workspaceId, signal.id));
      throw error;
    }
  },
);
