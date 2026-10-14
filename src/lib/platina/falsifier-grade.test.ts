import { describe, expect, it } from "vitest";
import { earnedConfidence, gradeEventId, gradeInsight, HELD_MARGIN } from "./falsifier-grade";
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
