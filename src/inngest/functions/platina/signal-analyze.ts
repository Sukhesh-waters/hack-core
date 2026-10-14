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
import { getExpectation, upsertExpectation } from "@/db/queries/platina-expectations";
import { runWithAiCost } from "@/lib/ai/usage-context";
import { ANALYSIS_GLOBAL_CONCURRENCY, ANALYSIS_THROTTLE } from "@/lib/platina/analysis";
import { planAnalysis } from "@/lib/platina/analysis-plan";
import { buildNumberedAnalysisInput } from "@/lib/platina/analysis-input";
import { analysisWrites, type AnalysisWriteContext, type AnalysisWritesV2Input } from "@/lib/platina/analysis-writes";
import { modeOf } from "@/lib/platina/brain-modes";
import { recordBrainEvent } from "@/lib/platina/brain-telemetry";
import { ANALYSIS_PROMPT_VERSION, runContradictionRound, runInterrogationRound } from "@/lib/platina/debate";
import { embedText } from "@/lib/platina/embed";
import { measureDeps } from "@/lib/platina/falsifier-metrics-deps";
import { FALSIFIER_METRICS, measureMetric, type FalsifierClaim, type FalsifierMetricId } from "@/lib/platina/falsifier-metrics";
import { gateInsight, type GateResult, type GateSignificance, type GateTestability } from "@/lib/platina/insight-gate";
import { chunkDirectionFor, INTERROGATION_PROMPT_VERSION } from "@/lib/platina/interrogation";
import { BASELINE_DAYS, RECENT_DAYS } from "@/lib/platina/measurement-scales";
import { broadcastPlatinaSignal } from "@/lib/platina/realtime-server";
import { isSignificant, mannWhitneyOneSided, splitRecentBaseline } from "@/lib/platina/significance";

const DAY_MS = 86_400_000;

/**
 * B3 — the significance check is scoped to the ONE registry metric that is
 * actually framed as a recent-vs-baseline trend (`ratio_of_medians`); the
 * others (`engagement_index`, `ad_days_running`, the per-row counts/latest
 * metrics) are snapshots, not a stated direction to test against noise.
 */
const TREND_METRIC: FalsifierMetricId = "topic_momentum";

/**
 * B3 — testability and significance for one claim's falsifier, read through
 * the real `measureDeps` (DB-backed). Pure arithmetic over what comes back
 * lives in falsifier-metrics.ts/significance.ts; this is only the plumbing
 * between them and the registry's declared minN — kept here (not in a
 * shared lib module) because it is the one place a DB-backed reader and the
 * job's own "now" meet.
 */
async function measureGateInputs(
  workspaceId: string,
  falsifier: FalsifierClaim,
  now: Date,
): Promise<{ testability: GateTestability; significance?: GateSignificance }> {
  const metricId = falsifier.metric as FalsifierMetricId;
  const def = FALSIFIER_METRICS[metricId];
  const measured = await measureMetric(measureDeps, workspaceId, metricId, falsifier.subject, falsifier.window_days, now);
  const testability: GateTestability = { n: measured.status === "not_measured" ? 0 : measured.n, minN: def.minN };

  if (metricId !== TREND_METRIC) {
    return { testability };
  }
  const lookbackFrom = new Date(now.getTime() - (RECENT_DAYS + BASELINE_DAYS) * DAY_MS);
  const raw = await measureDeps[metricId](workspaceId, falsifier.subject, lookbackFrom, now);
  const { recent, baseline } = splitRecentBaseline(raw, now);
  const direction = chunkDirectionFor(falsifier); // the claim's OWN asserted direction (mirror of falsifier.direction)
  const alternative = direction === "down" ? "less" : "greater";
  const significance = isSignificant(mannWhitneyOneSided(recent, baseline, alternative));
  return { testability, significance };
}

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
 *
 * B2: `modeOf(config, "challenger")` is the challenger's OWN mode, read
 * alongside `mode` and passed into `runInterrogationRound` as its 4th
 * argument. It only matters inside the v2 branch below — the v1 round above
 * has no numbered spans to build a blind prompt from, so a workspace can
 * run interrogation "off" and challenger "shadow"/"on" with no effect: the
 * v1 round that would run is simply never asked to blind. `result.blinded`
 * (true for "on", a 50/50 split by signal id for "shadow", else false) is
 * stored on the transcript's `blinded` column — unchanged cost either way,
 * same one challenger call (plan §5 B2).
 *
 * B4: `modeOf(config, "surprise")` is read BEFORE the "plan" step (unlike
 * challenger/gate above) because `planAnalysis` itself needs it to decide
 * whether to skip — the surprise dependency's load/save calls run inside
 * that same step.run, so a replay never double-saves the expectation
 * (Inngest memoizes a completed step). "off" costs one extra cheap
 * `getWorkspaceConfig` read (now fetched before, not after, the plan step)
 * and nothing else — no expectation read/write, byte-identical skip/analyse
 * decision either way (plan §2.1, §11.5). mode="on" and the statistic says
 * skip -> `plan.cause === "surprise"`, handled by the EXISTING generic skip
 * branch below (no special-casing needed: `analysisWrites`/`markSignalSkipped`
 * already forward any `BrainSkipCause` as-is). mode="shadow" never skips;
 * `plan.surprise` carries what the filter WOULD have decided, logged once
 * here, stage "surprise", decision "surprise_shadow" — independent of the
 * interrogation mode fork below. mode="on" and the statistic said skip but
 * the audit sample chose to analyse anyway -> `plan.audit === true`; the
 * final "processed" step below labels that document's funnel decision
 * "audit_sample" instead of "analysed" (both already counted as "reached a
 * model" by brain-telemetry.ts's `summariseFunnel` — anticipated when B0
 * wrote that set).
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
          return { kind: null, brandName: null, clientName: null, sourceKind, brandId: null };
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
          // B4 — the entity this scan spec watches, keys the per-brand
          // engagement/ads expectation (src/lib/platina/surprise.ts
          // expectationKey). Not used anywhere pre-B4.
          brandId: brand.id as string | null,
        };
      });

      // B4 — read before "plan" (unlike challenger/gate's modes, read after):
      // planAnalysis itself needs this to decide whether to skip. "off" costs
      // one cheap config read and nothing else (see file header).
      const config = await step.run("config", () => getWorkspaceConfig(workspaceId));
      const surpriseMode = modeOf(config, "surprise");

      // One tested decision (lib/platina/analysis-plan.ts): own-brand page,
      // low-value page, surprise-filter skip, or an analysis input that names
      // the competitor, the client and what changed. A skip here means no
      // provider is ever called.
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
            raw: signal.raw,
          },
          subject,
          loadPrevious: () =>
            getPreviousSignalDocument(
              workspaceId,
              signal.canonicalUrl,
              new Date(signal.fetchedAt),
            ),
          ...(surpriseMode !== "off"
            ? {
                surprise: {
                  mode: surpriseMode,
                  loadExpectation: (key: string) => getExpectation(workspaceId, key),
                  saveExpectation: (key: string, next) => upsertExpectation(workspaceId, key, next),
                  docId: signal.id,
                  floor: config?.surpriseFloor,
                  auditShare: config?.surpriseAuditShare,
                },
              }
            : {}),
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
        // Already generic: analysisWrites/markSignalSkipped forward any
        // BrainSkipCause as-is, so cause "surprise" (mode "on") needs no
        // special-casing here — same branch as own_brand/low_value.
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

      // B4, mode "shadow" only: what the filter would have decided, logged
      // once here — independent of the interrogation mode fork below, and
      // never gating anything (the document is always analysed in shadow).
      if (plan.surprise) {
        await step.run("surprise-shadow", () =>
          recordBrainEvent({
            workspaceId,
            stage: "surprise",
            decision: "surprise_shadow",
            subjectId: signal.id,
            detail: {
              wouldSkip: plan.surprise!.wouldSkip,
              reason: plan.surprise!.reason,
              deviation: plan.surprise!.deviation,
            },
          }),
        );
      }
      // B4, mode "on" only: the statistic said skip, but the deterministic
      // audit sample analysed it anyway (plan §5 B4). Both "audit_sample"
      // and "analysed" already count as "reached a model" in
      // brain-telemetry.ts's summariseFunnel (anticipated when B0 wrote that
      // set) — this only changes which of the two is recorded below.
      const analysisOutcomeDecision = plan.audit ? "audit_sample" : "analysed";

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
      // B2: the challenger's OWN mode — only consulted inside
      // runInterrogationRound (the v2/v1 fork below), because the v1 round
      // (mode="off", immediately below) has no numbered spans to blind
      // with. A workspace can watch the blind challenger in shadow before
      // its interrogation is itself "on".
      const challengerMode = modeOf(config, "challenger");
      // B3 — the gate's OWN mode (plan §5 B3): only consulted inside the v2
      // branch below, same reasoning as `challengerMode` above — the v1
      // round has no validated evidence coverage or falsifier to gate.
      const gateMode = modeOf(config, "gate");

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
            // the prompt version — the before-number for agreement-by-model.
            // `blinded` is always false here: this is the v1 round
            // (runContradictionRound), which B2 never touches — it has no
            // numbered spans to build a blind prompt from. The B2 blind
            // challenger lives only in the v2 (interrogation) round below.
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
            decision: analysisOutcomeDecision,
            subjectId: signal.id,
            promptVersion: ANALYSIS_PROMPT_VERSION,
            detail: {
              state: result.result.state,
              changed: plan.changed,
              providers: result.providers,
              // B4 — the spot-check's own result (plan §5 B4): did the
              // model find anything on this would-skip document? Only
              // meaningful (and only read) when decision is "audit_sample".
              ...(plan.audit ? { foundSomething: Boolean(writes.finding) || Boolean(brainChunkId) } : {}),
            },
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
          runInterrogationRound(
            numbered,
            floors,
            { resolvesSubjectKey },
            { signalId: signal.id, mode: challengerMode },
            { mode: gateMode },
          ),
        ),
      );

      // B3 (D7) — shadow only: what resolveV2 would have decided instead of
      // today's resolve(), logged so §14's shadow numbers can be read before
      // any flip to "on" (plan §5 B3, §10 D7). `result` above already used
      // the old (v1) state for the write either way.
      if (result.gateShadow) {
        await recordBrainEvent({
          workspaceId,
          stage: "gate",
          decision: "resolve_v2",
          subjectId: signal.id,
          promptVersion: INTERROGATION_PROMPT_VERSION,
          detail: result.gateShadow,
        });
      }

      const now = new Date();
      // B3: only a validated claim/fact is worth gating — an invalid
      // interrogation already has its own, more fundamental, "untestable"
      // handling above (mode="on" skips before this point; mode="shadow"
      // continues with grade_state "insufficient", gate or no gate). "off"
      // costs nothing: no DB reads, gateResult stays undefined.
      let gateResult: GateResult | undefined;
      if (gateMode !== "off" && result.interrogation.ok) {
        gateResult = await step.run("gate", async () => {
          const value = result.interrogation.ok ? result.interrogation.value : null;
          const falsifier = value?.kind === "claim" ? value.falsifier : null;
          const measured = falsifier ? await measureGateInputs(workspaceId, falsifier, now) : undefined;
          const verdict = gateInsight({
            interrogation: result.interrogation,
            falsifier: falsifier ? { metric: falsifier.metric } : null,
            testability: measured?.testability ?? null,
            significance: measured?.significance,
            resolveState: result.result.state,
          });
          // One telemetry row per failing reason, coded by WHICH check
          // failed (the job already knows this — no need to parse the
          // plain-word `reasons` text back into a category). Pooled with
          // market-insight-writer.ts's own "significance" holds into the
          // Brain quality card's "Held by the quality check" row. There is
          // no "schema" case to log here: this branch only ever runs once
          // `result.interrogation.ok` is already true (checked above,
          // before `step.run` is even called) — an invalid interrogation
          // has its own, more fundamental, handling (see the comment above
          // this block).
          if (!verdict.pass) {
            if (measured?.testability && measured.testability.n < measured.testability.minN) {
              await recordBrainEvent({ workspaceId, stage: "gate", decision: "testability", subjectId: signal.id, detail: { n: measured.testability.n, minN: measured.testability.minN, mode: gateMode } });
            }
            if (measured?.significance && !measured.significance.significant) {
              await recordBrainEvent({ workspaceId, stage: "gate", decision: "significance", subjectId: signal.id, detail: { reason: measured.significance.reason, mode: gateMode } });
            }
          }
          return verdict;
        });
      }

      const v2: AnalysisWritesV2Input = {
        mode,
        interrogation: result.interrogation,
        parsed: result.parsed,
        signalDocumentId: signal.id,
        now,
        promptVersion: INTERROGATION_PROMPT_VERSION,
        writtenBy: "interrogation-v1",
        ...(gateResult ? { gate: { mode: gateMode, result: gateResult } } : {}),
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
          // B2: whether THIS round's challenger actually saw the blind
          // prompt (off -> always false; shadow -> the 50/50 split by
          // signal id; on -> always true). Computed in debate.ts, not here.
          blinded: result.blinded,
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
          decision: analysisOutcomeDecision,
          subjectId: signal.id,
          promptVersion: INTERROGATION_PROMPT_VERSION,
          detail: {
            state: result.result.state,
            changed: plan.changed,
            providers: result.providers,
            ...(plan.audit ? { foundSomething: Boolean(writes.finding) || Boolean(brainChunkId) } : {}),
          },
        });
      });
      return { analysed: signal.id, state: result.result.state };
    } catch (error) {
      await step.run("release", () => releaseSignal(workspaceId, signal.id));
      throw error;
    }
  },
);
