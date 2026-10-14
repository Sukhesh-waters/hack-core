import { inngest } from "@/inngest/client";
import { listAllWorkspaceIds } from "@/db/queries/workspaces";
import { getWorkspaceConfig } from "@/db/queries/platina";
import {
  gradeCountsForChunk,
  insertGrade,
  listDueFalsifierChunks,
  type DueFalsifierChunk,
} from "@/db/queries/platina-grades";
import { setBrainState } from "@/db/queries/platina-brain";
import { listSuggestionsCitingBrainChunk } from "@/db/queries/platina-learning";
import { recordDecision } from "@/lib/platina/suggestions-record";
import { modeOf } from "@/lib/platina/brain-modes";
import { recordBrainEvent } from "@/lib/platina/brain-telemetry";
import { broadcastPlatinaSignal } from "@/lib/platina/realtime-server";
import { earnedConfidence, gradeEventId, gradeInsight, type GradeVerdict } from "@/lib/platina/falsifier-grade";
import { FALSIFIER_METRICS, measureMetric, type FalsifierMetricId } from "@/lib/platina/falsifier-metrics";
import { measureDeps } from "@/lib/platina/falsifier-metrics-deps";

/** Plan §12 "pages of 200" — one step.run grades a whole page, so a crash resumes at the next page, not the first chunk of the current one. */
const PAGE_SIZE = 200;
/** Only these two verdicts feed the C8.5 ledger (plan §5 B5 step 6): a tested prediction that actually held or failed, not an inconclusive one. */
const LEDGER_VERDICTS: readonly GradeVerdict[] = ["refuted", "promoted"];

/**
 * Grades every due chunk in one page and applies the mode's behaviour
 * (plan §5 B5):
 *  - shadow: the grade row is inserted; telemetry is recorded; the Brain
 *    chunk is never touched.
 *  - on: the grade row is inserted, then setBrainState (the only writer of
 *    Brain-chunk state) applies the transition, and a refuted/promoted
 *    chunk's citing suggestions get a ledger "result" event (credit.ts picks
 *    it up with no new learning code).
 * A conflict on the grade's unique key (brain_chunk_id, window_days, metric)
 * means this exact chunk was already graded by an earlier, crashed attempt
 * at this page — `inserted: false` — and no state change is attempted again.
 */
async function gradeChunk(
  workspaceId: string,
  mode: "shadow" | "on",
  now: Date,
  chunk: DueFalsifierChunk,
): Promise<{ graded: boolean; changed: boolean }> {
  const metricId = chunk.falsifier.metric as FalsifierMetricId;
  const def = FALSIFIER_METRICS[metricId];
  // Defensive only: B1's assertFalsifiableClaim already refuses to write a
  // claim whose metric is not in the registry, so this never fires in
  // practice — it exists so a future registry change can never crash a page.
  if (!def) return { graded: false, changed: false };

  const measurement = await measureMetric(measureDeps, workspaceId, metricId, chunk.falsifier.subject, chunk.falsifier.window_days, now);
  const graded = gradeInsight({ falsifier: chunk.falsifier, measurement, now, dueAt: chunk.dueAt });
  // "pending" is unreachable here (the due-chunks query already filters
  // due_at <= now), but if it ever happens, write nothing — plan §5 B5's
  // table says "window not elapsed -> none".
  if (graded.verdict === "pending") return { graded: false, changed: false };

  const { id: gradeId, inserted } = await insertGrade({
    workspaceId,
    brainChunkId: chunk.id,
    metric: metricId,
    scaleVersion: def.scaleVersion,
    windowDays: chunk.falsifier.window_days,
    threshold: chunk.falsifier.threshold,
    direction: chunk.falsifier.direction,
    measuredValue: graded.measured?.value ?? null,
    n: graded.measured?.n ?? 0,
    verdict: graded.verdict,
    plane: def.plane,
  });

  await recordBrainEvent({
    workspaceId,
    stage: "grading",
    decision: graded.verdict,
    subjectId: chunk.id,
    detail: { metric: metricId, reason: graded.reason, inserted, mode },
  });

  // Already graded by a prior, crashed pass over this same page — never
  // re-decide a chunk's state twice from one conflicting insert.
  if (!inserted) return { graded: false, changed: false };
  if (mode === "shadow") return { graded: true, changed: false };

  let diff: unknown[];
  if (graded.verdict === "refuted") {
    diff = await setBrainState(workspaceId, chunk.id, { status: "demoted", gradeState: "refuted", confidence: 0.05 }, "grading", gradeId);
  } else if (graded.verdict === "promoted") {
    const { held, refuted } = await gradeCountsForChunk(workspaceId, chunk.id);
    diff = await setBrainState(workspaceId, chunk.id, { gradeState: "promoted", confidence: earnedConfidence(held, refuted) }, "grading", gradeId);
  } else if (graded.verdict === "holding") {
    diff = await setBrainState(workspaceId, chunk.id, { gradeState: "holding" }, "grading", gradeId);
  } else {
    // insufficient — stays retrievable (plan §5 B5): no status change.
    diff = await setBrainState(workspaceId, chunk.id, { gradeState: "insufficient" }, "grading", gradeId);
  }

  if (LEDGER_VERDICTS.includes(graded.verdict)) {
    const citing = await listSuggestionsCitingBrainChunk(workspaceId, chunk.id);
    for (const s of citing) {
      await recordDecision({
        workspaceId,
        suggestionId: s.id,
        kind: "result",
        reward: graded.verdict === "promoted" ? 1 : 0,
        detail: { gradeId, verdict: graded.verdict, brainChunkId: chunk.id },
        now,
      });
    }
  }

  return { graded: true, changed: diff.length > 0 };
}

async function gradeOnePage(
  workspaceId: string,
  mode: "shadow" | "on",
  now: Date,
  afterId: string | null,
): Promise<{ pageSize: number; lastId: string | null; changed: boolean }> {
  const page = await listDueFalsifierChunks(workspaceId, now, { limit: PAGE_SIZE, afterId: afterId ?? undefined });
  let changed = false;
  for (const chunk of page) {
    const result = await gradeChunk(workspaceId, mode, now, chunk);
    if (result.changed) changed = true;
  }
  return { pageSize: page.length, lastId: page.length > 0 ? page[page.length - 1]!.id : afterId, changed };
}

/**
 * Daily fan-out (plan §5 B5, §12): one `platina/falsifier.grade` event per
 * workspace, event id `grade:<ws>:<day>` so a re-run collapses into the same
 * delivery (same pattern as platina-scan-coordinator's tick fan-out).
 */
export const platinaFalsifierGradeSweep = inngest.createFunction(
  { id: "platina-falsifier-grade-sweep", triggers: [{ cron: "0 5 * * *" }] },
  async ({ step }) => {
    const workspaceIds = await step.run("list-workspaces", () => listAllWorkspaceIds());
    const now = Date.now();
    if (workspaceIds.length > 0) {
      await step.sendEvent(
        "dispatch-grading",
        workspaceIds.map((workspaceId) => ({
          id: gradeEventId(workspaceId, now),
          name: "platina/falsifier.grade",
          data: { workspaceId },
        })),
      );
    }
    return { dispatched: workspaceIds.length };
  },
);

/**
 * Grades every due chunk for one workspace (plan §5 B5). `mode =
 * modeOf(config, "grading")`: off returns immediately; shadow writes grades
 * with no state change; on applies the full transition and ledger link.
 * Catch-up by construction (plan §15.3): due chunks are selected by
 * `due_at <= now`, so a missed 05:00 run (the local Inngest dev server is
 * down, plan §13) is simply picked up whenever this next runs — never
 * "yesterday's chunks only".
 */
export const platinaFalsifierGrade = inngest.createFunction(
  {
    id: "platina-falsifier-grade",
    triggers: [{ event: "platina/falsifier.grade" }],
    concurrency: { key: "event.data.workspaceId", limit: 1 },
  },
  async ({ event, step }) => {
    const data = (event?.data ?? {}) as { workspaceId?: string };
    const workspaceId = data.workspaceId;
    if (typeof workspaceId !== "string") return { skipped: "no workspaceId" };

    const config = await step.run("config", () => getWorkspaceConfig(workspaceId));
    const mode = modeOf(config, "grading");
    if (mode === "off") return { workspaceId, mode, graded: 0 };

    const now = new Date();
    let afterId: string | null = null;
    let page = 0;
    let graded = 0;
    let changedAny = false;
    for (;;) {
      page += 1;
      const result = await step.run(`page-${page}`, () => gradeOnePage(workspaceId, mode, now, afterId));
      graded += result.pageSize;
      if (result.changed) changedAny = true;
      afterId = result.lastId;
      if (result.pageSize < PAGE_SIZE) break;
    }

    if (mode === "on" && changedAny) {
      await step.run("broadcast", () => broadcastPlatinaSignal(workspaceId, "insights"));
    }

    return { workspaceId, mode, graded, pages: page };
  },
);
