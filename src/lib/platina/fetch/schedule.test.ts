import { describe, expect, it } from "vitest";
import {
  ADAPTIVE_MAX_MINUTES,
  ADAPTIVE_START_MINUTES,
  backoffInterval,
  costCapReached,
  isDue,
  isProbeCapable,
  jitterMinutes,
  MAX_FETCHES_PER_DAY,
  nextDueAt,
  tightenInterval,
  type SchedulableSpec,
} from "./schedule";

const base = (overrides: Partial<SchedulableSpec> = {}): SchedulableSpec => ({
  id: "spec-1",
  enabled: true,
  status: "approved",
  cadenceMinutes: 5,
  lastProbeAt: null,
  lastSuccessAt: null,
  currentIntervalMinutes: null,
  consecutiveUnchanged: 0,
  fetchesDay: null,
  fetchesToday: 0,
  ...overrides,
});

const NOW = new Date("2026-09-17T12:00:00Z");

describe("cadence scheduling", () => {
  it("a never-probed source is due immediately", () => {
    expect(isDue(base(), true, NOW)).toBe(true);
  });

  it("a probed source is not due inside its cadence", () => {
    const spec = base({
      lastProbeAt: new Date(NOW.getTime() - 2 * 60_000),
      id: "spec-no-jitter-check",
    });
    // cadence 5m + jitter 0–4m → due between +5m and +9m; 2m ago is never due
    expect(isDue(spec, true, NOW)).toBe(false);
  });

  it("a probed source is due after cadence + max jitter", () => {
    const spec = base({ lastProbeAt: new Date(NOW.getTime() - 10 * 60_000) });
    expect(isDue(spec, true, NOW)).toBe(true);
  });

  it("drafts and disabled sources are never due", () => {
    expect(isDue(base({ status: "draft" }), true, NOW)).toBe(false);
    expect(isDue(base({ enabled: false }), true, NOW)).toBe(false);
  });

  it("jitter is deterministic per spec and bounded", () => {
    expect(jitterMinutes("spec-1")).toBe(jitterMinutes("spec-1"));
    for (const id of ["a", "b", "c", "spec-1", "spec-2"]) {
      expect(jitterMinutes(id)).toBeGreaterThanOrEqual(0);
      expect(jitterMinutes(id)).toBeLessThan(5);
    }
  });

  it("probe-less sources start on the 6-hour adaptive interval", () => {
    const spec = base({
      lastSuccessAt: new Date(NOW.getTime() - 60 * 60_000),
    });
    const due = nextDueAt(spec, false);
    const lastSuccess = new Date(spec.lastSuccessAt!).getTime();
    const diffMinutes = (due.getTime() - lastSuccess) / 60_000;
    expect(diffMinutes).toBeGreaterThanOrEqual(ADAPTIVE_START_MINUTES);
    expect(diffMinutes).toBeLessThan(ADAPTIVE_START_MINUTES + 5);
  });
});

describe("adaptive interval", () => {
  it("doubles on unchanged fetches, capped at 24 h", () => {
    expect(backoffInterval(null)).toBe(ADAPTIVE_START_MINUTES * 2);
    expect(backoffInterval(ADAPTIVE_START_MINUTES)).toBe(720);
    expect(backoffInterval(720)).toBe(1440);
    expect(backoffInterval(1440)).toBe(ADAPTIVE_MAX_MINUTES);
    expect(backoffInterval(ADAPTIVE_MAX_MINUTES)).toBe(ADAPTIVE_MAX_MINUTES);
  });

  it("halves toward the cadence floor on change", () => {
    expect(tightenInterval(null, 5)).toBe(180);
    expect(tightenInterval(360, 5)).toBe(180);
    expect(tightenInterval(10, 5)).toBe(5);
    expect(tightenInterval(6, 15)).toBe(15);
  });
});

describe("cost cap", () => {
  it("is not reached on a new day", () => {
    expect(
      costCapReached(
        base({ fetchesDay: "2026-09-16", fetchesToday: MAX_FETCHES_PER_DAY }),
        NOW,
      ),
    ).toBe(false);
  });

  it("is reached at the daily limit", () => {
    expect(
      costCapReached(
        base({ fetchesDay: "2026-09-17", fetchesToday: MAX_FETCHES_PER_DAY }),
        NOW,
      ),
    ).toBe(true);
  });

  it("is not reached below the limit", () => {
    expect(
      costCapReached(base({ fetchesDay: "2026-09-17", fetchesToday: 3 }), NOW),
    ).toBe(false);
  });
});

describe("probe capability", () => {
  it("matches the actor-matrix verification", () => {
    expect(isProbeCapable("competitor_site")).toBe(true);
    expect(isProbeCapable("ad_library")).toBe(false);
    expect(isProbeCapable("trade_editorial")).toBe(false);
  });
});
