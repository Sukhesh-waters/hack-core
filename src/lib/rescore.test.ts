import { describe, expect, it } from "vitest";
import { buildRescorePlan, rescoreRequestedEvent, type ScorableRow } from "./rescore";
import { MIN_BASELINE_N } from "./scoring";

describe("rescoreRequestedEvent (C2s)", () => {
  it("names the event the rescoreSweep Inngest function listens for", () => {
    expect(rescoreRequestedEvent("ws1").name).toBe("posts/rescore.requested");
  });

  it("carries the workspaceId rescoreSweep reads off event.data", () => {
    expect(rescoreRequestedEvent("ws1").data).toEqual({ workspaceId: "ws1" });
  });
});

const NOW = new Date("2026-07-08T12:00:00Z");

function rows(
  clientId: string,
  rates: Array<number | null>,
  start = 0,
): ScorableRow[] {
  return rates.map((engagementRate, i) => ({
    id: `${clientId}_p${start + i}`,
    clientId,
    engagementRate,
    postedAt: new Date(NOW.getTime() - (i + 1) * 86_400_000),
  }));
}

describe("buildRescorePlan", () => {
  it("below min-N: every row is insufficient_baseline — no fabricated scores", () => {
    const plan = buildRescorePlan(rows("c1", [0.04, 0.05, 0.06]), NOW);
    expect(plan).toHaveLength(3);
    for (const update of plan) {
      expect(update.scoreStatus).toBe("insufficient_baseline");
      expect(update.magnitude).toBeNull();
    }
  });

  it("at min-N: rows score, outliers get direction + magnitude", () => {
    const rates = Array.from({ length: MIN_BASELINE_N - 1 }, () => 0.05);
    const plan = buildRescorePlan(rows("c1", [...rates, 0.2]), NOW);
    expect(plan).toHaveLength(MIN_BASELINE_N);
    const outlier = plan.find((u) => u.id === `c1_p${MIN_BASELINE_N - 1}`);
    expect(outlier?.scoreStatus).toBe("scored");
    expect(outlier?.direction).toBe("up");
    expect(outlier?.magnitude ?? 0).toBeGreaterThan(0.5);
  });

  it("a new published result re-weights existing rows (the learning loop)", () => {
    const base = rows("c1", [
      ...Array.from({ length: MIN_BASELINE_N }, (_, i) =>
        i % 2 === 0 ? 0.04 : 0.06,
      ),
      0.09,
    ]);
    const before = buildRescorePlan(base, NOW);
    const star = before.find((u) => u.id === `c1_p${MIN_BASELINE_N}`);

    // Publish-back: two strong results land, the old star is less special
    const after = buildRescorePlan(
      [...base, ...rows("c1", [0.18, 0.2], 100)],
      NOW,
    );
    const starAfter = after.find((u) => u.id === `c1_p${MIN_BASELINE_N}`);
    expect(star?.scoreStatus).toBe("scored");
    expect(starAfter?.scoreStatus).toBe("scored");
    expect(starAfter!.zScore!).toBeLessThan(star!.zScore!);
  });

  it("baselines are per client — a small client stays insufficient", () => {
    const plan = buildRescorePlan(
      [
        ...rows("big", Array.from({ length: MIN_BASELINE_N }, () => 0.05)),
        ...rows("small", [0.5, 0.6]),
      ],
      NOW,
    );
    expect(
      plan.filter((u) => u.id.startsWith("big_")).every(
        (u) => u.scoreStatus === "scored",
      ),
    ).toBe(true);
    expect(
      plan.filter((u) => u.id.startsWith("small_")).every(
        (u) => u.scoreStatus === "insufficient_baseline",
      ),
    ).toBe(true);
  });

  it("null engagement rate stays unscored and out of the baseline", () => {
    const plan = buildRescorePlan(rows("c1", [null, 0.05]), NOW);
    expect(plan.find((u) => u.id === "c1_p0")?.scoreStatus).toBe("unscored");
  });
});
