import { describe, expect, it } from "vitest";
import { QUEUED_STUCK_MINUTES, runSummary, type RunRow } from "./run-summary";

const NOW = new Date("2026-09-20T12:00:00Z");
const run = (over: Partial<RunRow> = {}): RunRow => ({
  specId: "s1",
  status: "completed",
  queuedAt: new Date(NOW.getTime() - 30_000),
  counters: {},
  errorReason: null,
  degradedReason: null,
  ...over,
});

describe("runSummary", () => {
  it("says a source has not run yet, and is not in flight", () => {
    expect(runSummary(undefined, NOW)).toEqual({ text: "Not run yet", active: false });
  });

  it("marks queued, running and analysing runs as in flight (drives the auto-refresh)", () => {
    for (const status of ["queued", "running", "validating"]) {
      expect(runSummary(run({ status }), NOW).active).toBe(true);
    }
  });

  it("uses the same words the user sees while it works", () => {
    expect(runSummary(run({ status: "running" }), NOW).text).toBe("Reading pages…");
    expect(runSummary(run({ status: "validating" }), NOW).text).toBe("Analysing…");
  });

  it("points at the job runner when a run has sat queued too long", () => {
    const stuck = run({ status: "queued", queuedAt: new Date(NOW.getTime() - (QUEUED_STUCK_MINUTES + 1) * 60_000) });
    expect(runSummary(stuck, NOW).text).toContain("waiting for the job runner");
    expect(runSummary(run({ status: "queued" }), NOW).text).toBe("Queued");
  });

  it("reports real counters when done, and never invents them", () => {
    expect(runSummary(run({ counters: { fetched: 5, inserted: 3 } }), NOW)).toEqual({
      text: "Done: 5 page(s), 3 new",
      active: false,
    });
    expect(runSummary(run({ counters: {} }), NOW).text).toBe("Done: 0 page(s), 0 new");
  });

  it("carries the actual reason for a failed or degraded run", () => {
    expect(runSummary(run({ status: "failed", errorReason: "Apify refused the run (402)" }), NOW).text).toBe(
      "Failed: Apify refused the run (402)",
    );
    expect(runSummary(run({ status: "degraded", degradedReason: "targets failed: x" }), NOW).text).toContain(
      "targets failed: x",
    );
    expect(runSummary(run({ status: "failed" }), NOW).text).toBe("Failed: see runs");
  });
});
