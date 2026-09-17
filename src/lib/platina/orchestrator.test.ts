import { describe, expect, it } from "vitest";
import type { PlatinaAnalysisStep } from "@/db/platina-schema";
import {
  executeAuditRun,
  manualIdempotencyKey,
  snapshotRunConfig,
  type AuditRunRecord,
  type OrchestratorDeps,
  type TransitionInput,
} from "./orchestrator";

function makeRun(overrides: Partial<AuditRunRecord> = {}): AuditRunRecord {
  return {
    id: "run-1",
    workspaceId: "ws-1",
    specId: "spec-1",
    status: "queued",
    configSnapshot: snapshotRunConfig(null),
    counters: {},
    ...overrides,
  };
}

type FakeStore = {
  run: AuditRunRecord;
  transitions: TransitionInput[];
  broadcasts: string[];
  contradictions: string[];
  specRuns: string[];
  fetchImpl: () => Promise<{ fetched: number }>;
};

function makeDeps(store: FakeStore): OrchestratorDeps {
  return {
    loadRun: async () => store.run,
    transition: async (input) => {
      // Mirror the guarded DB update: refuse when the current status is not
      // in the from-list.
      if (!input.from.includes(store.run.status)) return null;
      store.run = { ...store.run, status: input.to };
      store.transitions.push(input);
      return input.runId;
    },
    runFetchStage: async () => store.fetchImpl(),
    dispatchContradiction: async (ws) => {
      store.contradictions.push(ws);
    },
    markSpecRun: async (ws, specId) => {
      store.specRuns.push(`${ws}:${specId}`);
    },
    broadcast: async (ws, runId) => {
      store.broadcasts.push(`${ws}:${runId}`);
    },
  };
}

function makeStore(
  run: AuditRunRecord,
  fetchImpl: FakeStore["fetchImpl"] = async () => ({ fetched: 3 }),
): FakeStore {
  return {
    run,
    transitions: [],
    broadcasts: [],
    contradictions: [],
    specRuns: [],
    fetchImpl,
  };
}

describe("snapshotRunConfig", () => {
  it("freezes defaults when no config exists", () => {
    const snap = snapshotRunConfig(null);
    expect(snap.analysisSequence).toEqual([
      "competitor_scan",
      "brand_divergence",
      "ideation",
    ]);
    expect(snap.promptVersion).toBe(1);
    expect(snap.minBaselineN).toBe(20);
  });

  it("copies values so later config edits cannot rewrite the run", () => {
    const config = {
      analysisSequence: ["competitor_scan"] as PlatinaAnalysisStep[],
      promptVersion: 7,
      minBaselineN: 50,
      contestedFloor: 0.5,
      qualifiedFloor: 0.8,
    };
    const snap = snapshotRunConfig(config);
    config.promptVersion = 99;
    config.analysisSequence.push("ideation");
    expect(snap.promptVersion).toBe(7);
    expect(snap.analysisSequence).toEqual(["competitor_scan"]);
  });
});

describe("executeAuditRun", () => {
  it("walks queued → running → validating → completed with broadcasts after each commit", async () => {
    const store = makeStore(makeRun());
    const outcome = await executeAuditRun(makeDeps(store), "ws-1", "run-1");
    expect(outcome.outcome).toBe("completed");
    expect(store.run.status).toBe("completed");
    expect(store.transitions.map((t) => t.to)).toEqual([
      "running",
      "validating",
      "completed",
    ]);
    expect(store.broadcasts).toHaveLength(3);
    expect(store.contradictions).toEqual(["ws-1"]);
    expect(store.specRuns).toEqual(["ws-1:spec-1"]);
  });

  it("is a no-op on a terminal run (idempotent re-entry)", async () => {
    const store = makeStore(makeRun({ status: "completed" }));
    const outcome = await executeAuditRun(makeDeps(store), "ws-1", "run-1");
    expect(outcome).toEqual({
      outcome: "skipped",
      reason: "run already completed",
    });
    expect(store.transitions).toHaveLength(0);
  });

  it("skips when the pickup guard loses a race", async () => {
    const run = makeRun({ status: "running" });
    const store = makeStore(run);
    const outcome = await executeAuditRun(makeDeps(store), "ws-1", "run-1");
    expect(outcome.outcome).toBe("skipped");
    expect(store.transitions).toHaveLength(0);
  });

  it("marks failed when the fetch stage throws", async () => {
    const store = makeStore(makeRun(), async () => {
      throw new Error("adapter timeout");
    });
    const outcome = await executeAuditRun(makeDeps(store), "ws-1", "run-1");
    expect(outcome).toEqual({ outcome: "failed", reason: "adapter timeout" });
    expect(store.run.status).toBe("failed");
    expect(store.transitions.map((t) => t.to)).toEqual(["running", "failed"]);
    expect(store.contradictions).toHaveLength(0);
  });

  it("marks degraded when the run has no source attached", async () => {
    const store = makeStore(makeRun({ specId: null }));
    const outcome = await executeAuditRun(makeDeps(store), "ws-1", "run-1");
    expect(outcome.outcome).toBe("degraded");
    expect(store.run.status).toBe("degraded");
    expect(store.specRuns).toHaveLength(0);
  });

  it("records deferred stages as skipped in the timeline, never silently", async () => {
    const store = makeStore(makeRun());
    await executeAuditRun(makeDeps(store), "ws-1", "run-1");
    const validating = store.transitions.find((t) => t.to === "validating");
    expect(validating?.message).toContain("competitor_scan: 3 documents fetched");
    expect(validating?.message).toContain("brand_divergence: skipped");
    expect(validating?.message).toContain("ideation: skipped");
  });

  it("does not dispatch contradiction when nothing was fetched", async () => {
    const store = makeStore(makeRun(), async () => ({ fetched: 0 }));
    await executeAuditRun(makeDeps(store), "ws-1", "run-1");
    expect(store.contradictions).toHaveLength(0);
  });
});

describe("manualIdempotencyKey", () => {
  it("is stable within a minute and differs across minutes", () => {
    const at = new Date("2026-09-17T12:34:56Z");
    const sameMinute = new Date("2026-09-17T12:34:10Z");
    const nextMinute = new Date("2026-09-17T12:35:01Z");
    expect(manualIdempotencyKey("s1", at)).toBe(manualIdempotencyKey("s1", sameMinute));
    expect(manualIdempotencyKey("s1", at)).not.toBe(manualIdempotencyKey("s1", nextMinute));
  });
});
