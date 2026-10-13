import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYSIS_DECISIONS, recordBrainEvent, summariseFunnel } from "./brain-telemetry";

describe("ANALYSIS_DECISIONS", () => {
  it("includes every exit analysis-plan.ts has today, plus the ones later stages add", () => {
    expect(ANALYSIS_DECISIONS).toEqual(
      expect.arrayContaining(["own_brand", "low_value", "nothing_new", "analysed"]),
    );
    expect(ANALYSIS_DECISIONS).toEqual(
      expect.arrayContaining(["untestable", "gate", "surprise", "audit_sample"]),
    );
  });
});

describe("summariseFunnel", () => {
  it("counts analysed and audit_sample as reaching a model call; everything else stops", () => {
    const summary = summariseFunnel([
      { stage: "analysis", decision: "own_brand", count: 10 },
      { stage: "analysis", decision: "low_value", count: 20 },
      { stage: "analysis", decision: "nothing_new", count: 5 },
      { stage: "analysis", decision: "analysed", count: 50 },
      { stage: "analysis", decision: "audit_sample", count: 3 },
    ]);
    expect(summary.analysed).toBe(53);
    expect(summary.stoppedBy).toEqual({ own_brand: 10, low_value: 20, nothing_new: 5 });
  });

  it("modelCallShare is null (not measured) when fetched is not supplied", () => {
    const summary = summariseFunnel([{ stage: "analysis", decision: "analysed", count: 10 }]);
    expect(summary.modelCallShare).toBeNull();
    expect(summary.fetched).toBeUndefined();
  });

  it("modelCallShare is analysed / fetched when fetched is supplied", () => {
    const summary = summariseFunnel(
      [
        { stage: "analysis", decision: "analysed", count: 25 },
        { stage: "analysis", decision: "low_value", count: 75 },
      ],
      100,
    );
    expect(summary.fetched).toBe(100);
    expect(summary.modelCallShare).toBeCloseTo(0.25);
  });

  it("modelCallShare is null when fetched is explicitly 0 (never divides by zero)", () => {
    const summary = summariseFunnel([], 0);
    expect(summary.fetched).toBe(0);
    expect(summary.modelCallShare).toBeNull();
  });

  it("merges counts for the same decision across multiple rows", () => {
    const summary = summariseFunnel([
      { stage: "analysis", decision: "low_value", count: 3 },
      { stage: "analysis", decision: "low_value", count: 4 },
    ]);
    expect(summary.stoppedBy.low_value).toBe(7);
  });

  it("is empty-safe", () => {
    expect(summariseFunnel([])).toEqual({ analysed: 0, stoppedBy: {}, modelCallShare: null });
  });
});

describe("recordBrainEvent", () => {
  const insertBrainTelemetry = vi.fn();
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    insertBrainTelemetry.mockReset();
    vi.doMock("@/db/queries/platina-brain", () => ({ insertBrainTelemetry }));
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.doUnmock("@/db/queries/platina-brain");
    vi.resetModules();
    warnSpy.mockRestore();
  });

  it("writes the event with explicit nulls for omitted optional fields", async () => {
    insertBrainTelemetry.mockResolvedValue("tel_1");
    await recordBrainEvent({ workspaceId: "ws_a", stage: "analysis", decision: "analysed" });
    expect(insertBrainTelemetry).toHaveBeenCalledWith({
      workspaceId: "ws_a",
      stage: "analysis",
      decision: "analysed",
      subjectId: null,
      detail: null,
      promptVersion: null,
    });
  });

  it("passes through optional fields when given", async () => {
    insertBrainTelemetry.mockResolvedValue("tel_2");
    await recordBrainEvent({
      workspaceId: "ws_a",
      stage: "challenger",
      decision: "objection",
      subjectId: "sig_1",
      detail: { note: "x" },
      promptVersion: "v1",
    });
    expect(insertBrainTelemetry).toHaveBeenCalledWith({
      workspaceId: "ws_a",
      stage: "challenger",
      decision: "objection",
      subjectId: "sig_1",
      detail: { note: "x" },
      promptVersion: "v1",
    });
  });

  it("never throws, even when the write fails", async () => {
    insertBrainTelemetry.mockRejectedValue(new Error("db down"));
    await expect(
      recordBrainEvent({ workspaceId: "ws_a", stage: "analysis", decision: "analysed" }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});
