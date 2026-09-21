import { describe, expect, it } from "vitest";
import {
  MAX_FETCHES_PER_DAY,
  specPagesRemaining,
  workspacePagesRemaining,
  type SchedulableSpec,
} from "./schedule";

const NOW = new Date("2026-09-20T12:00:00Z");
const spec = (over: Partial<SchedulableSpec> = {}): SchedulableSpec => ({
  id: "s1",
  enabled: true,
  status: "approved",
  cadenceMinutes: 15,
  lastProbeAt: null,
  lastSuccessAt: null,
  currentIntervalMinutes: null,
  consecutiveUnchanged: 0,
  fetchesDay: null,
  fetchesToday: 0,
  ...over,
});

describe("page-level spend caps", () => {
  it("a fresh day gives the source its full page budget", () => {
    expect(specPagesRemaining(spec({ fetchesDay: "2026-09-19", fetchesToday: 48 }), NOW)).toBe(
      MAX_FETCHES_PER_DAY,
    );
  });

  it("counts pages already read today against the source", () => {
    expect(specPagesRemaining(spec({ fetchesDay: "2026-09-20", fetchesToday: 30 }), NOW)).toBe(
      MAX_FETCHES_PER_DAY - 30,
    );
    expect(specPagesRemaining(spec({ fetchesDay: "2026-09-20", fetchesToday: 99 }), NOW)).toBe(0);
  });

  it("workspace remaining floors at zero — the pause condition", () => {
    expect(workspacePagesRemaining(10, 40)).toBe(30);
    expect(workspacePagesRemaining(40, 40)).toBe(0);
    expect(workspacePagesRemaining(75, 40)).toBe(0);
  });
});
