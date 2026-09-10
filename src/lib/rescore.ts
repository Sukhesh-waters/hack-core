import {
  scoreAgainstBaseline,
  type BaselinePoint,
  type PostScore,
} from "@/lib/scoring";

/**
 * Learning-loop core (W7): recompute every first-party row's score against
 * its client's CURRENT baseline. Each published result grows the baseline,
 * so magnitudes shift — this is what "re-weights drivers" (retrieval ranks
 * by magnitude). Pure; the Inngest job stays thin.
 */

export type ScorableRow = {
  id: string;
  clientId: string;
  engagementRate: number | null;
  postedAt: Date;
};

export type ScoreUpdate = {
  id: string;
  zScore: number | null;
  magnitude: number | null;
  direction: "up" | "down" | "flat" | null;
  scoreStatus: "scored" | "insufficient_baseline" | "unscored";
};

/**
 * C2s: the event `markPublishedAction` must emit so `rescoreSweep`
 * (src/inngest/functions/rescore.ts) actually runs. Pure so the "did
 * publish wire up the learning loop" contract is testable without an
 * Inngest client — the fix for a defect that shipped silently once
 * already (a comment claimed this action "never queues a rescore").
 */
export function rescoreRequestedEvent(workspaceId: string) {
  return {
    name: "posts/rescore.requested" as const,
    data: { workspaceId },
  };
}

function toUpdate(id: string, score: PostScore): ScoreUpdate {
  if (score.status === "insufficient_baseline") {
    // Min-N gate: an honest status, never a fabricated number
    return {
      id,
      zScore: null,
      magnitude: null,
      direction: null,
      scoreStatus: "insufficient_baseline",
    };
  }
  return {
    id,
    zScore: score.zScore,
    magnitude: score.magnitude,
    direction: score.direction,
    scoreStatus: "scored",
  };
}

export function buildRescorePlan(
  rows: ScorableRow[],
  now: Date = new Date(),
): ScoreUpdate[] {
  // Baselines are per client — one account's results never re-weight another
  const byClient = new Map<string, ScorableRow[]>();
  for (const row of rows) {
    const list = byClient.get(row.clientId) ?? [];
    list.push(row);
    byClient.set(row.clientId, list);
  }

  const updates: ScoreUpdate[] = [];
  for (const clientRows of Array.from(byClient.values())) {
    const baseline: BaselinePoint[] = clientRows
      .filter((row) => row.engagementRate !== null)
      .map((row) => ({
        value: row.engagementRate as number,
        postedAt: row.postedAt,
      }));

    for (const row of clientRows) {
      if (row.engagementRate === null) {
        updates.push({
          id: row.id,
          zScore: null,
          magnitude: null,
          direction: null,
          scoreStatus: "unscored",
        });
        continue;
      }
      updates.push(
        toUpdate(
          row.id,
          scoreAgainstBaseline(row.engagementRate, baseline, now),
        ),
      );
    }
  }
  return updates;
}
