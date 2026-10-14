/**
 * Writes measured market insights into the Brain (C5): builds the sentences
 * (market-insights.ts), embeds only what changed, supersedes what was
 * replaced or no longer holds. Runs after interest extraction (per client)
 * and after event extraction (per workspace), so the planner and ideation
 * retrieve today's measurements with the same vector + keyword search they
 * use for every other insight.
 */
import type { TopicMomentum } from "./interest";
import type { FalsifierClaim } from "./falsifier-metrics";
import type { BrainMode } from "./brain-modes";
import { recordBrainEvent } from "./brain-telemetry";
import {
  eventInsights,
  interestInsights,
  planInsightWrites,
  type InsightEvent,
  type InsightSignal,
  type MarketInsight,
} from "./market-insights";

const DAY_MS = 86_400_000;

export type InsightWriterDeps = {
  embed: (text: string) => Promise<number[] | null>;
  listActive: (
    workspaceId: string,
    prefix: string,
  ) => Promise<{ id: string; insightKey: string | null; content: string }[]>;
  insert: (row: {
    workspaceId: string;
    content: string;
    confidence: number;
    agreementState: "qualified";
    sourceSignalIds: string[];
    embedding?: number[];
    insightKey: string;
    // B1 (metacognitive Brain) — see market-insights.ts MarketInsight and
    // falsifier-metrics.ts. Always "measured"/"insight-writer-v2" for a
    // code-built insight; falsifier/subjectKey/direction/dueAt follow
    // whatever the producer (interestInsights/eventInsights/adInsights) set,
    // null when that insight kind has no fitting registry metric.
    kind: "measured";
    writtenBy: "insight-writer-v2";
    falsifier: FalsifierClaim | null;
    subjectKey: string | null;
    direction: "up" | "down" | "none";
    dueAt: Date | null;
  }) => Promise<string>;
  supersede: (workspaceId: string, ids: string[]) => Promise<void>;
};

export type InsightWriteResult = { written: number; superseded: number; unchanged: number; unembedded: number };

async function apply(
  deps: InsightWriterDeps,
  workspaceId: string,
  prefix: string,
  wanted: MarketInsight[],
  now: Date,
  gateMode: BrainMode = "off",
): Promise<InsightWriteResult> {
  const active = await deps.listActive(workspaceId, prefix);
  const plan = planInsightWrites(wanted, active);
  let unembedded = 0;
  for (const insight of plan.insert) {
    // B3 (gate): logged for every insight whose stated trend did not clear
    // the significance check — "off/shadow -> content unchanged (shadow
    // logs what would change)" (plan §5 B3). `recordBrainEvent` never
    // throws, so this cannot turn a successful insight write into a failed
    // one; it is also never awaited into the write path below (fire-and-forget,
    // same as every other telemetry call in this codebase).
    if (gateMode !== "off" && insight.gateCheck && !insight.gateCheck.significant) {
      void recordBrainEvent({
        workspaceId,
        stage: "gate",
        decision: "significance",
        subjectId: insight.key,
        detail: { reason: insight.gateCheck.reason, mode: gateMode, wouldChange: gateMode === "shadow" },
      });
    }
    // A router outage stores the insight without a vector (keyword search
    // still finds it) rather than dropping it — same as debate claims.
    const embedding = await deps.embed(insight.content).catch(() => null);
    if (!embedding) unembedded += 1;
    const falsifier = insight.falsifier ?? null;
    await deps.insert({
      workspaceId,
      content: insight.content,
      confidence: insight.confidence,
      // Measured, not debated: qualified by its own numbers and proofs.
      agreementState: "qualified",
      sourceSignalIds: insight.sourceSignalIds,
      ...(embedding ? { embedding } : {}),
      insightKey: insight.key,
      // B1: code-built falsifier, never a model's (plan §5 B1).
      kind: "measured",
      writtenBy: "insight-writer-v2",
      falsifier,
      subjectKey: insight.subjectKey ?? null,
      direction: insight.direction ?? "none",
      dueAt: falsifier ? new Date(now.getTime() + falsifier.window_days * DAY_MS) : null,
    });
  }
  // Supersede after inserting, so there is never a moment with neither.
  await deps.supersede(workspaceId, plan.supersede);
  return {
    written: plan.insert.length,
    superseded: plan.supersede.length,
    unchanged: wanted.length - plan.insert.length,
    unembedded,
  };
}

/** Interest and pressure insights for one client and its competitors. */
export function writeClientInsights(
  deps: InsightWriterDeps,
  input: {
    workspaceId: string;
    client: { id: string; name: string };
    names: Map<string, string>;
    momentum: TopicMomentum[];
    signals: InsightSignal[];
    /** B1: due_at anchor for a written falsifier. Defaults to now. */
    now?: Date;
    /** B3 (gate) — defaults "off": today's B1 behaviour, byte-identical. */
    gateMode?: BrainMode;
  },
): Promise<InsightWriteResult> {
  const wanted = interestInsights(input);
  const now = input.now ?? new Date();
  const gateMode = input.gateMode ?? "off";
  // Both prefixes belong to this client; one pass per prefix keeps "no
  // longer holds" scoped to what this pass measured.
  return Promise.all([
    apply(deps, input.workspaceId, `interest:${input.client.id}:`, wanted.filter((w) => w.key.startsWith("interest:")), now, gateMode),
    apply(deps, input.workspaceId, `pressure:${input.client.id}:`, wanted.filter((w) => w.key.startsWith("pressure:")), now, gateMode),
  ]).then(([a, b]) => ({
    written: a.written + b.written,
    superseded: a.superseded + b.superseded,
    unchanged: a.unchanged + b.unchanged,
    unembedded: a.unembedded + b.unembedded,
  }));
}

/**
 * Ad-library detections for one client (C8.3): pushes, region gaps, ad white
 * space, long runners. Their own prefix, so a detection that no longer holds
 * is retired without touching interest or pressure insights.
 */
export function writeAdInsights(
  deps: InsightWriterDeps,
  input: { workspaceId: string; clientId: string; insights: MarketInsight[]; now?: Date },
): Promise<InsightWriteResult> {
  return apply(deps, input.workspaceId, `ads:${input.clientId}:`, input.insights, input.now ?? new Date());
}

/** Upcoming-event insights for a workspace. */
export function writeEventInsights(
  deps: InsightWriterDeps,
  input: { workspaceId: string; names: Map<string, string>; events: InsightEvent[]; now: Date },
): Promise<InsightWriteResult> {
  return apply(deps, input.workspaceId, "event:", eventInsights(input), input.now);
}
