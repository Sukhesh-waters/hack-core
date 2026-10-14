import { describe, expect, it } from "vitest";
import {
  earnedConfidence,
  gradeEventId,
  gradeInsight,
  HELD_MARGIN,
  insufficientAttemptsExhausted,
  MAX_INSUFFICIENT_ATTEMPTS,
  nextDueAt,
} from "./falsifier-grade";
import type { FalsifierClaim } from "./falsifier-metrics";

const now = new Date("2026-11-20T05:00:00Z");
const dueAt = new Date("2026-11-19T00:00:00Z"); // already elapsed

const below: FalsifierClaim = {
  metric: "topic_momentum",
  subject: { topic: "pfas analysis" },
  direction: "below",
  threshold: 1.0,
  window_days: 30,
};

const above: FalsifierClaim = {
  metric: "ad_days_running",
  subject: { brand: "acme", topic: "pfas analysis" },
  direction: "above",
  threshold: 30,
  window_days: 30,
};

describe("gradeInsight — window not elapsed", () => {
  it("is pending when now is before dueAt (no row should be written)", () => {
    const result = gradeInsight({
      falsifier: below,
      measurement: { status: "measured", value: 0.5, n: 10 },
      now: new Date("2026-11-01T00:00:00Z"),
      dueAt: new Date("2026-11-19T00:00:00Z"),
    });
    expect(result.verdict).toBe("pending");
    expect(result.measured).toBeUndefined();
  });

  it("is pending when dueAt is null (no falsifier window to test)", () => {
    const result = gradeInsight({ falsifier: below, measurement: { status: "not_measured" }, now, dueAt: null });
    expect(result.verdict).toBe("pending");
  });
});

describe("gradeInsight — insufficient", () => {
  it("not_measured -> insufficient, never a synthesised number", () => {
    const result = gradeInsight({ falsifier: below, measurement: { status: "not_measured" }, now, dueAt });
    expect(result.verdict).toBe("insufficient");
    expect(result.reason).toMatch(/not enough data/i);
    expect(result.measured).toBeUndefined();
  });

  it("below minN -> insufficient, reason names the n", () => {
    const result = gradeInsight({ falsifier: below, measurement: { status: "insufficient", n: 2 }, now, dueAt });
    expect(result.verdict).toBe("insufficient");
    expect(result.reason).toContain("2");
    expect(result.measured).toBeUndefined();
  });
});

describe("gradeInsight — refuted (triggered)", () => {
  it("direction=below: value under the threshold triggers", () => {
    const result = gradeInsight({ falsifier: below, measurement: { status: "measured", value: 0.6, n: 8 }, now, dueAt });
    expect(result.verdict).toBe("refuted");
    expect(result.measured).toEqual({ value: 0.6, n: 8 });
  });

  it("direction=above: value over the threshold triggers", () => {
    const result = gradeInsight({ falsifier: above, measurement: { status: "measured", value: 45, n: 6 }, now, dueAt });
    expect(result.verdict).toBe("refuted");
  });

  it("is refuted even when the value is ON the opposite side but still crosses (boundary: exactly at threshold does not trigger)", () => {
    const atThreshold = gradeInsight({ falsifier: below, measurement: { status: "measured", value: 1.0, n: 8 }, now, dueAt });
    expect(atThreshold.verdict).not.toBe("refuted");
  });
});

describe("gradeInsight — promoted (held, clears margin)", () => {
  it("direction=below: value comfortably above threshold (>=10%) is promoted", () => {
    // threshold 1.0, margin 0.1 -> held requires value >= 1.1
    const result = gradeInsight({ falsifier: below, measurement: { status: "measured", value: 1.15, n: 9 }, now, dueAt });
    expect(result.verdict).toBe("promoted");
  });

  it("direction=above: value comfortably below threshold (>=10%) is promoted", () => {
    // threshold 30, margin 3 -> held requires value <= 27
    const result = gradeInsight({ falsifier: above, measurement: { status: "measured", value: 20, n: 9 }, now, dueAt });
    expect(result.verdict).toBe("promoted");
  });

  it("exactly at the margin boundary counts as promoted (>=)", () => {
    const result = gradeInsight({ falsifier: below, measurement: { status: "measured", value: 1.1, n: 9 }, now, dueAt });
    expect(result.verdict).toBe("promoted");
  });
});

describe("gradeInsight — holding (not triggered, margin not cleared)", () => {
  it("direction=below: value just above threshold but inside the margin holds", () => {
    const result = gradeInsight({ falsifier: below, measurement: { status: "measured", value: 1.05, n: 9 }, now, dueAt });
    expect(result.verdict).toBe("holding");
  });

  it("direction=above: value just below threshold but inside the margin holds", () => {
    const result = gradeInsight({ falsifier: above, measurement: { status: "measured", value: 29, n: 9 }, now, dueAt });
    expect(result.verdict).toBe("holding");
  });
});

describe("gradeInsight — threshold of zero (degenerate margin)", () => {
  const zeroBelow: FalsifierClaim = { ...below, threshold: 0 };
  it("margin is zero, so any non-triggering value is promoted", () => {
    const result = gradeInsight({ falsifier: zeroBelow, measurement: { status: "measured", value: 0, n: 5 }, now, dueAt });
    expect(result.verdict).toBe("promoted");
  });
});

describe("HELD_MARGIN", () => {
  it("is documented as 10%", () => {
    expect(HELD_MARGIN).toBe(0.1);
  });
});

describe("earnedConfidence", () => {
  it("is the uninformative prior (0.5) with no grades", () => {
    expect(earnedConfidence(0, 0)).toBe(0.5);
  });

  it("rises with held grades, falls with refuted ones", () => {
    expect(earnedConfidence(3, 0)).toBeGreaterThan(0.5);
    expect(earnedConfidence(0, 3)).toBeLessThan(0.5);
  });

  it("matches the Beta(1+held, 1+refuted) mean exactly", () => {
    expect(earnedConfidence(1, 0)).toBeCloseTo(2 / 3, 10);
    expect(earnedConfidence(0, 1)).toBeCloseTo(1 / 3, 10);
    expect(earnedConfidence(2, 2)).toBe(0.5);
  });

  it("never returns a value outside [0, 1] for negative input (defensive clamp)", () => {
    expect(earnedConfidence(-5, -5)).toBe(0.5);
  });
});

describe("gradeEventId", () => {
  it("is stable within the same UTC day for a workspace", () => {
    const a = gradeEventId("ws_a", new Date("2026-11-20T00:00:01Z").getTime());
    const b = gradeEventId("ws_a", new Date("2026-11-20T23:59:59Z").getTime());
    expect(a).toBe(b);
    expect(a).toBe("grade:ws_a:2026-11-20");
  });

  it("differs across workspaces and across days", () => {
    const t = new Date("2026-11-20T12:00:00Z").getTime();
    expect(gradeEventId("ws_a", t)).not.toBe(gradeEventId("ws_b", t));
    expect(gradeEventId("ws_a", t)).not.toBe(gradeEventId("ws_a", t + 24 * 60 * 60 * 1000));
  });
});

describe("nextDueAt", () => {
  it("is windowDays forward from `now`, not from any prior due_at", () => {
    const t = new Date("2026-11-20T05:00:00Z");
    expect(nextDueAt(t, 30).toISOString()).toBe("2026-12-20T05:00:00.000Z");
    expect(nextDueAt(t, 90).toISOString()).toBe("2027-02-18T05:00:00.000Z");
  });

  it("gives a full fresh window even when graded very late (catch-up, plan §15.3)", () => {
    // A chunk due 2026-11-01 but not graded until 2026-12-15 (dev server
    // down for weeks) still gets +30 days from the actual grading moment,
    // not from the stale due_at — so it isn't immediately due again.
    const gradedLate = new Date("2026-12-15T00:00:00Z");
    const next = nextDueAt(gradedLate, 30);
    expect(next.getTime()).toBeGreaterThan(gradedLate.getTime());
    expect(next.toISOString()).toBe("2027-01-14T00:00:00.000Z");
  });
});

describe("insufficientAttemptsExhausted / MAX_INSUFFICIENT_ATTEMPTS", () => {
  it("is documented as 3", () => {
    expect(MAX_INSUFFICIENT_ATTEMPTS).toBe(3);
  });

  it("is not exhausted below the cap", () => {
    expect(insufficientAttemptsExhausted(0)).toBe(false);
    expect(insufficientAttemptsExhausted(1)).toBe(false);
    expect(insufficientAttemptsExhausted(2)).toBe(false);
  });

  it("is exhausted at and beyond the cap", () => {
    expect(insufficientAttemptsExhausted(3)).toBe(true);
    expect(insufficientAttemptsExhausted(4)).toBe(true);
  });
});

describe("the re-test lifecycle: holding is not terminal (plan §5 B5)", () => {
  it("a chunk graded holding, then re-measured at its pushed-forward due date, can go on to refute", () => {
    // Day 1: due 2026-11-19, measured just inside the margin -> holding.
    const day1Due = new Date("2026-11-19T00:00:00Z");
    const day1Now = new Date("2026-11-20T05:00:00Z");
    const first = gradeInsight({
      falsifier: below,
      measurement: { status: "measured", value: 1.05, n: 9 },
      now: day1Now,
      dueAt: day1Due,
    });
    expect(first.verdict).toBe("holding");

    // The grader pushes due_at forward by the falsifier's own window (30 d)
    // from the grading moment — exactly nextDueAt's contract.
    const day2Due = nextDueAt(day1Now, below.window_days);
    expect(day2Due.toISOString()).toBe("2026-12-20T05:00:00.000Z");

    // Day 2 (a month later): the SAME chunk, now measured below threshold.
    const day2Now = new Date("2026-12-21T00:00:00Z");
    const second = gradeInsight({
      falsifier: below,
      measurement: { status: "measured", value: 0.5, n: 9 },
      now: day2Now,
      dueAt: day2Due,
    });
    expect(second.verdict).toBe("refuted");
  });

  it("a chunk graded holding, then re-measured, can instead go on to promote", () => {
    const day1Due = new Date("2026-11-19T00:00:00Z");
    const day1Now = new Date("2026-11-20T05:00:00Z");
    expect(
      gradeInsight({ falsifier: above, measurement: { status: "measured", value: 29, n: 9 }, now: day1Now, dueAt: day1Due })
        .verdict,
    ).toBe("holding");

    const day2Due = nextDueAt(day1Now, above.window_days);
    const second = gradeInsight({
      falsifier: above,
      measurement: { status: "measured", value: 20, n: 9 },
      now: new Date(day2Due.getTime() + 60_000),
      dueAt: day2Due,
    });
    expect(second.verdict).toBe("promoted");
  });

  it("insufficient grades the SAME chunk across multiple windows until the retry cap is reached", () => {
    // Simulates what the Inngest handler does across three separate daily
    // runs: each time, `gradeCountsForChunk`'s insufficient count (not
    // modelled here directly — this proves the pure decision it feeds)
    // climbs by one, and only the 3rd attempt is exhausted.
    let insufficientSoFar = 0;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = gradeInsight({
        falsifier: below,
        measurement: { status: "not_measured" },
        now,
        dueAt,
      });
      expect(result.verdict).toBe("insufficient");
      insufficientSoFar += 1; // the grade row this attempt just inserted
      const exhausted = insufficientAttemptsExhausted(insufficientSoFar);
      expect(exhausted).toBe(attempt === 3);
    }
  });
});
