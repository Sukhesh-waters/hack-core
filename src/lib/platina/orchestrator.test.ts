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
  specOutcomes: { specId: string; inserted: number; failed: boolean }[];
  fetchImpl: () => Promise<{
    fetched: number;
    inserted: number;
    failures: string[];
  }>;
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
    recordSpecOutcome: async (ws, specId, outcome) => {
      store.specOutcomes.push({ specId, ...outcome });
    },
    broadcast: async (ws, runId) => {
      store.broadcasts.push(`${ws}:${runId}`);
    },
  };
}

function makeStore(
  run: AuditRunRecord,
  fetchImpl: FakeStore["fetchImpl"] = async () => ({
    fetched: 3,
    inserted: 3,
    failures: [],
  }),
): FakeStore {
  return {
    run,
    transitions: [],
    broadcasts: [],
    contradictions: [],
    specOutcomes: [],
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
    expect(store.specOutcomes).toEqual([
      { specId: "spec-1", inserted: 3, failed: false, pages: 3 },
    ]);
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

  it("a spend cap is a pause, not a failure: degraded with the reason, the source's record untouched", async () => {
    // C7.1 found it live: capped conference sources read as "failing" on the
    // ops board, and a failure backs the source's cadence off.
    for (const reason of ["daily collection cap reached", "daily page limit for this source reached"]) {
      const store = makeStore(makeRun(), async () => {
        throw new Error(reason);
      });
      const outcome = await executeAuditRun(makeDeps(store), "ws-1", "run-1");
      expect(outcome).toMatchObject({ outcome: "degraded", reason });
      expect(store.run.status).toBe("degraded");
      expect(store.transitions.at(-1)).toMatchObject({ to: "degraded", degradedReason: reason });
      expect(store.specOutcomes).toEqual([]);
      expect(store.contradictions).toHaveLength(0);
    }
  });

  it("marks degraded when the run has no source attached", async () => {
    const store = makeStore(makeRun({ specId: null }));
    const outcome = await executeAuditRun(makeDeps(store), "ws-1", "run-1");
    expect(outcome.outcome).toBe("degraded");
    expect(store.run.status).toBe("degraded");
    expect(store.specOutcomes).toHaveLength(0);
  });

  it("marks degraded when some targets fail but others succeed", async () => {
    const store = makeStore(makeRun(), async () => ({
      fetched: 2,
      inserted: 2,
      failures: ["https://bad.example.com (timeout)"],
    }));
    const outcome = await executeAuditRun(makeDeps(store), "ws-1", "run-1");
    expect(outcome.outcome).toBe("degraded");
    expect(store.run.status).toBe("degraded");
    expect(store.contradictions).toEqual(["ws-1"]);
  });

  it("records deferred stages as skipped in the timeline, never silently", async () => {
    const store = makeStore(makeRun());
    await executeAuditRun(makeDeps(store), "ws-1", "run-1");
    const validating = store.transitions.find((t) => t.to === "validating");
    expect(validating?.message).toContain(
      "competitor_scan: 3 fetched, 3 new",
    );
    expect(validating?.message).toContain("brand_divergence: skipped");
    expect(validating?.message).toContain("ideation: skipped");
  });

  it("does not dispatch contradiction when nothing was fetched", async () => {
    const store = makeStore(makeRun(), async () => ({
      fetched: 0,
      inserted: 0,
      failures: [],
    }));
    await executeAuditRun(makeDeps(store), "ws-1", "run-1");
    expect(store.contradictions).toHaveLength(0);
  });
});

describe("executeAuditRun — analysis stages (core spine S5)", () => {
  const withStages = (
    store: FakeStore,
    stages: Partial<Pick<OrchestratorDeps, "runDivergenceStage" | "runIdeationStage">>,
  ): OrchestratorDeps => ({ ...makeDeps(store), ...stages });

  it("runs all three default stages and reports real counters per stage", async () => {
    const store = makeStore(makeRun());
    const deps = withStages(store, {
      runDivergenceStage: async () => ({ status: "done", produced: 2, note: "2 new divergence(s)" }),
      runIdeationStage: async () => ({ status: "done", produced: 1, note: "1 new direction(s)" }),
    });
    const result = await executeAuditRun(deps, "ws-1", "run-1");
    expect(result).toMatchObject({ outcome: "completed" });
    const message = store.transitions.find((t) => t.to === "validating")?.message ?? "";
    expect(message).toContain("competitor_scan: 3 fetched");
    expect(message).toContain("brand_divergence: 2 new divergence(s)");
    expect(message).toContain("ideation: 1 new direction(s)");
    expect(store.transitions.at(-1)?.counters).toMatchObject({ brand_divergence: 2, ideation: 1 });
  });

  it("a stage that throws marks the run degraded with the reason, never completed", async () => {
    const store = makeStore(makeRun());
    const deps = withStages(store, {
      runDivergenceStage: async () => {
        throw new Error("2 divergence(s) rejected: uncited");
      },
      runIdeationStage: async () => ({ status: "done", produced: 0, note: "0 new direction(s)" }),
    });
    const result = await executeAuditRun(deps, "ws-1", "run-1");
    expect(result).toMatchObject({ outcome: "degraded" });
    expect(store.transitions.at(-1)?.degradedReason).toContain("brand_divergence failed");
  });

  it("a stage that legitimately has nothing to do is skipped with its reason, not degraded", async () => {
    const store = makeStore(makeRun());
    const deps = withStages(store, {
      runDivergenceStage: async () => ({ status: "skipped", reason: "no declared brand standard yet" }),
      runIdeationStage: async () => ({ status: "skipped", reason: "needs 3 validated patterns, has 0" }),
    });
    const result = await executeAuditRun(deps, "ws-1", "run-1");
    expect(result).toMatchObject({ outcome: "completed" });
    expect(store.transitions.find((t) => t.to === "validating")?.message).toContain(
      "brand_divergence: skipped (no declared brand standard yet)",
    );
  });

  it("a run in which no stage did any work never reads completed", async () => {
    const run = makeRun({
      configSnapshot: { ...snapshotRunConfig(null), analysisSequence: ["brand_divergence", "ideation"] },
    });
    const store = makeStore(run);
    const result = await executeAuditRun(makeDeps(store), "ws-1", "run-1");
    expect(result).toMatchObject({ outcome: "degraded", reason: "no analysis stage ran" });
  });

  it("does not run analysis stages when this run's own fetch failed", async () => {
    const store = makeStore(makeRun(), async () => {
      throw new Error("apify 402");
    });
    let ran = false;
    const deps = withStages(store, {
      runDivergenceStage: async () => {
        ran = true;
        return { status: "done", produced: 0, note: "" };
      },
    });
    expect(await executeAuditRun(deps, "ws-1", "run-1")).toMatchObject({ outcome: "failed" });
    expect(ran).toBe(false);
  });

  it("charges the source for pages returned, not for runs", async () => {
    const store = makeStore(makeRun(), async () => ({ fetched: 3, inserted: 1, failures: [], pages: 25 } as never));
    await executeAuditRun(makeDeps(store), "ws-1", "run-1");
    expect((store.specOutcomes[0] as { pages?: number }).pages).toBe(25);
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

describe("R9 — a rendered retry is a note, never a failure", () => {
  it("puts fetch notes on the timeline and leaves the run completed", async () => {
    const store = makeStore(makeRun());
    const deps: OrchestratorDeps = {
      ...makeDeps(store),
      runFetchStage: async () => ({
        fetched: 3,
        inserted: 3,
        failures: [],
        pages: 3,
        notes: [
          "https://acme.test: now read with a browser (the page returned almost no text)",
        ],
      }),
    };
    const outcome = await executeAuditRun(deps, "ws-1", "run-1");

    expect(outcome.outcome).toBe("completed");
    const messages = store.transitions.map((t) => t.message ?? "").join(" | ");
    expect(messages).toContain("now read with a browser");
    // The whole point: a note must not become a degradedReason.
    expect(store.transitions.some((t) => t.degradedReason)).toBe(false);
  });
});
