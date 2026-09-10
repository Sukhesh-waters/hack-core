import { describe, expect, it } from "vitest";
import { calculateTemplateMetrics, MIN_SOP_SAMPLE_N } from "./metrics";

describe("calculateTemplateMetrics", () => {
  it("returns zeroed metrics for empty runs array", () => {
    const result = calculateTemplateMetrics("tmpl-1", []);

    expect(result).toEqual({
      templateId: "tmpl-1",
      totalRuns: 0,
      completedRunsCount: 0,
      activeRunsCount: 0,
      cancelledRunsCount: 0,
      avgDurationHours: null,
      avgDurationDays: null,
      onTimeRate: null,
      hasEnoughData: false,
      minSampleRequired: MIN_SOP_SAMPLE_N,
      bottlenecks: [],
      slowestStep: null,
      runs: [],
    });
  });

  it("suppresses aggregate averages when sample size is below Min-N threshold", () => {
    const createdAt = new Date("2026-03-01T10:00:00Z");
    const completedAt = new Date("2026-03-02T10:00:00Z"); // 24 hours later
    const anchorDate = new Date("2026-03-02T12:00:00Z");

    const runs = [
      {
        id: "run-1",
        name: "Run 1",
        clientId: "client-1",
        clientName: "Acme Corp",
        startedById: "user-1",
        startedByName: "Alice",
        status: "completed" as const,
        createdAt,
        completedAt,
        anchorDate,
        steps: [
          {
            id: "step-1",
            templateStepId: "ts-1",
            title: "Drafting",
            status: "done",
            dueAt: anchorDate,
            completedAt,
            rejectionReason: null,
            createdAt,
          },
        ],
      },
      {
        id: "run-2",
        name: "Run 2",
        clientId: "client-1",
        clientName: "Acme Corp",
        startedById: "user-1",
        startedByName: "Alice",
        status: "completed" as const,
        createdAt,
        completedAt,
        anchorDate,
        steps: [],
      },
    ];

    // Only 2 completed runs, threshold is 3
    const result = calculateTemplateMetrics("tmpl-1", runs, 3);

    expect(result.totalRuns).toBe(2);
    expect(result.completedRunsCount).toBe(2);
    expect(result.hasEnoughData).toBe(false);
    expect(result.avgDurationHours).toBeNull();
    expect(result.avgDurationDays).toBeNull();
    expect(result.onTimeRate).toBeNull();

    // Individual run stats are still present
    expect(result.runs).toHaveLength(2);
    expect(result.runs[0]?.durationHours).toBe(24);
    expect(result.runs[0]?.durationDays).toBe(1);
    expect(result.runs[0]?.isOnTime).toBe(true);
  });

  it("calculates aggregate metrics, cycle times, and on-time rate when N >= threshold", () => {
    const baseDate = new Date("2026-03-01T00:00:00Z");

    // Run 1: took 24 hours (1 day), anchor was +24h -> on time
    const run1 = {
      id: "run-1",
      name: "Run 1",
      clientId: "client-1",
      clientName: "Client A",
      startedById: "u1",
      startedByName: "Bob",
      status: "completed" as const,
      createdAt: baseDate,
      completedAt: new Date(baseDate.getTime() + 24 * 3600 * 1000),
      anchorDate: new Date(baseDate.getTime() + 24 * 3600 * 1000),
      steps: [],
    };

    // Run 2: took 48 hours (2 days), anchor was +24h -> anchorDeadline = +48h (grace 24h) -> on time (at deadline)
    const run2 = {
      id: "run-2",
      name: "Run 2",
      clientId: "client-2",
      clientName: "Client B",
      startedById: "u1",
      startedByName: "Bob",
      status: "completed" as const,
      createdAt: baseDate,
      completedAt: new Date(baseDate.getTime() + 48 * 3600 * 1000),
      anchorDate: new Date(baseDate.getTime() + 24 * 3600 * 1000),
      steps: [],
    };

    // Run 3: took 72 hours (3 days), anchor was +24h -> anchorDeadline was +48h -> completed at +72h (LATE)
    const run3 = {
      id: "run-3",
      name: "Run 3",
      clientId: "client-1",
      clientName: "Client A",
      startedById: "u2",
      startedByName: "Carol",
      status: "completed" as const,
      createdAt: baseDate,
      completedAt: new Date(baseDate.getTime() + 72 * 3600 * 1000),
      anchorDate: new Date(baseDate.getTime() + 24 * 3600 * 1000),
      steps: [],
    };

    // Run 4: active run
    const run4 = {
      id: "run-4",
      name: "Run 4",
      clientId: null,
      clientName: null,
      startedById: "u1",
      startedByName: "Bob",
      status: "active" as const,
      createdAt: baseDate,
      completedAt: null,
      anchorDate: new Date(baseDate.getTime() + 48 * 3600 * 1000),
      steps: [],
    };

    const result = calculateTemplateMetrics("tmpl-1", [run1, run2, run3, run4], 3);

    expect(result.totalRuns).toBe(4);
    expect(result.completedRunsCount).toBe(3);
    expect(result.activeRunsCount).toBe(1);
    expect(result.cancelledRunsCount).toBe(0);
    expect(result.hasEnoughData).toBe(true);

    // Total hours: 24 + 48 + 72 = 144 / 3 = 48 hours
    expect(result.avgDurationHours).toBe(48);
    // Total days: 1 + 2 + 3 = 6 / 3 = 2 days
    expect(result.avgDurationDays).toBe(2);
    // On-time: 2 out of 3 = 66.7%
    expect(result.onTimeRate).toBe(66.7);
  });

  it("aggregates step bottlenecks and ranks slowest steps", () => {
    const t0 = new Date("2026-03-01T00:00:00Z");
    const t1 = new Date("2026-03-01T04:00:00Z"); // +4 hours
    const t2 = new Date("2026-03-01T12:00:00Z"); // +12 hours

    const run = {
      id: "run-1",
      name: "Run with Steps",
      clientId: null,
      clientName: null,
      startedById: "u1",
      startedByName: "User",
      status: "completed" as const,
      createdAt: t0,
      completedAt: t2,
      anchorDate: t2,
      steps: [
        {
          id: "s1",
          templateStepId: "ts-draft",
          title: "Draft Copy",
          status: "done",
          dueAt: t1,
          completedAt: t1, // 4 hours
          rejectionReason: null,
          createdAt: t0,
        },
        {
          id: "s2",
          templateStepId: "ts-review",
          title: "Client Review",
          status: "done",
          dueAt: t2,
          completedAt: t2, // 8 hours (t2 - t1)
          rejectionReason: "Copy too formal",
          createdAt: t1,
        },
      ],
    };

    const result = calculateTemplateMetrics("tmpl-1", [run]);

    expect(result.bottlenecks).toHaveLength(2);
    // Slowest step should be Client Review (8 hours)
    expect(result.slowestStep?.stepTitle).toBe("Client Review");
    expect(result.slowestStep?.avgDurationHours).toBe(8);
    expect(result.slowestStep?.rejectionCount).toBe(1);

    // Faster step
    expect(result.bottlenecks[1]?.stepTitle).toBe("Draft Copy");
    expect(result.bottlenecks[1]?.avgDurationHours).toBe(4);
    expect(result.bottlenecks[1]?.rejectionCount).toBe(0);
  });
});
