/**
 * Writes measured market insights into the Brain (C5): builds the sentences
 * (market-insights.ts), embeds only what changed, supersedes what was
 * replaced or no longer holds. Runs after interest extraction (per client)
 * and after event extraction (per workspace), so the planner and ideation
 * retrieve today's measurements with the same vector + keyword search they
 * use for every other insight.
 */
import type { TopicMomentum } from "./interest";
import {
  eventInsights,
  interestInsights,
  planInsightWrites,
  type InsightEvent,
  type InsightSignal,
  type MarketInsight,
} from "./market-insights";

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
  }) => Promise<string>;
  supersede: (workspaceId: string, ids: string[]) => Promise<void>;
};

export type InsightWriteResult = { written: number; superseded: number; unchanged: number; unembedded: number };

async function apply(
  deps: InsightWriterDeps,
  workspaceId: string,
  prefix: string,
  wanted: MarketInsight[],
): Promise<InsightWriteResult> {
  const active = await deps.listActive(workspaceId, prefix);
  const plan = planInsightWrites(wanted, active);
  let unembedded = 0;
  for (const insight of plan.insert) {
    // A router outage stores the insight without a vector (keyword search
    // still finds it) rather than dropping it — same as debate claims.
    const embedding = await deps.embed(insight.content).catch(() => null);
    if (!embedding) unembedded += 1;
    await deps.insert({
      workspaceId,
      content: insight.content,
      confidence: insight.confidence,
      // Measured, not debated: qualified by its own numbers and proofs.
      agreementState: "qualified",
      sourceSignalIds: insight.sourceSignalIds,
      ...(embedding ? { embedding } : {}),
      insightKey: insight.key,
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
  },
): Promise<InsightWriteResult> {
  const wanted = interestInsights(input);
  // Both prefixes belong to this client; one pass per prefix keeps "no
  // longer holds" scoped to what this pass measured.
  return Promise.all([
    apply(deps, input.workspaceId, `interest:${input.client.id}:`, wanted.filter((w) => w.key.startsWith("interest:"))),
    apply(deps, input.workspaceId, `pressure:${input.client.id}:`, wanted.filter((w) => w.key.startsWith("pressure:"))),
  ]).then(([a, b]) => ({
    written: a.written + b.written,
    superseded: a.superseded + b.superseded,
    unchanged: a.unchanged + b.unchanged,
    unembedded: a.unembedded + b.unembedded,
  }));
}

/** Upcoming-event insights for a workspace. */
export function writeEventInsights(
  deps: InsightWriterDeps,
  input: { workspaceId: string; names: Map<string, string>; events: InsightEvent[]; now: Date },
): Promise<InsightWriteResult> {
  return apply(deps, input.workspaceId, "event:", eventInsights(input));
}
