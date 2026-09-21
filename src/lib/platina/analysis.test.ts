import { describe, expect, it } from "vitest";
import {
  DAILY_ANALYSIS_CAP,
  STALE_CLAIM_MINUTES,
  SWEEP_BATCH,
  analysisBatchSize,
  analyzeEventId,
} from "./analysis";

describe("analysisBatchSize", () => {
  it("fans out a full batch while budget remains", () => {
    expect(analysisBatchSize(0)).toBe(SWEEP_BATCH);
  });

  it("with 200 queued signals it never dispatches past the daily cap", () => {
    // Simulate repeated sweeps draining a 200-signal backlog.
    let queued = 200;
    let analysed = 0;
    for (let sweep = 0; sweep < 10 && queued > 0; sweep++) {
      const n = Math.min(analysisBatchSize(analysed), queued);
      if (n === 0) break;
      analysed += n;
      queued -= n;
    }
    expect(analysed).toBe(DAILY_ANALYSIS_CAP);
    expect(queued).toBe(200 - DAILY_ANALYSIS_CAP);
  });

  it("shrinks the last batch to what the cap allows and stops at zero", () => {
    expect(analysisBatchSize(DAILY_ANALYSIS_CAP - 7)).toBe(7);
    expect(analysisBatchSize(DAILY_ANALYSIS_CAP)).toBe(0);
    expect(analysisBatchSize(DAILY_ANALYSIS_CAP + 30)).toBe(0);
  });

  it("gives a re-dispatch in the same window the same event id, so it is deduped", () => {
    const t = Date.UTC(2026, 8, 20, 12, 0, 0);
    expect(analyzeEventId("sig-1", t)).toBe(analyzeEventId("sig-1", t + 60_000));
    expect(analyzeEventId("sig-1", t)).not.toBe(analyzeEventId("sig-2", t));
  });

  it("lets a failed analysis be dispatched again after the stale window, instead of being ignored for 24h", () => {
    const t = Date.UTC(2026, 8, 20, 12, 0, 0);
    expect(analyzeEventId("sig-1", t)).not.toBe(analyzeEventId("sig-1", t + (STALE_CLAIM_MINUTES + 1) * 60_000));
  });
});
