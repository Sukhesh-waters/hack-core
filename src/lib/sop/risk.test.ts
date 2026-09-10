import { describe, expect, it } from "vitest";
import {
  daysLate,
  downstreamStepIds,
  isClosed,
  reanchoredDates,
  rescheduledDates,
  runRisk,
  type RiskStep,
} from "./risk";

const NOW = new Date(2026, 7, 20); // 20 Aug 2026

function step(
  id: string,
  overrides: Partial<RiskStep> = {},
): RiskStep {
  return {
    id,
    status: "ready",
    dueAt: NOW,
    dependsOn: [],
    ...overrides,
  };
}

describe("isClosed", () => {
  it("treats done and skipped as terminal", () => {
    expect(isClosed("done")).toBe(true);
    expect(isClosed("skipped")).toBe(true);
  });

  it("treats every open status as open", () => {
    expect(isClosed("blocked")).toBe(false);
    expect(isClosed("ready")).toBe(false);
    expect(isClosed("in_progress")).toBe(false);
  });
});

describe("daysLate", () => {
  it("is zero for a step due today", () => {
    expect(daysLate(new Date(2026, 7, 20), NOW)).toBe(0);
  });

  it("is zero for a future step", () => {
    expect(daysLate(new Date(2026, 7, 25), NOW)).toBe(0);
  });

  it("counts whole days past due", () => {
    expect(daysLate(new Date(2026, 7, 13), NOW)).toBe(7);
  });

  /**
   * Day granularity is the point: something due today is on time until the
   * day ends, not "0.6 days late" by the afternoon.
   */
  it("ignores time of day on both sides", () => {
    const dueMorning = new Date(2026, 7, 19, 8, 0);
    const nowEvening = new Date(2026, 7, 20, 23, 30);
    expect(daysLate(dueMorning, nowEvening)).toBe(1);
  });

  it("counts across a month boundary", () => {
    expect(daysLate(new Date(2026, 6, 30), new Date(2026, 7, 3))).toBe(4);
  });
});

describe("downstreamStepIds", () => {
  it("returns nothing when nothing depends on the step", () => {
    expect(downstreamStepIds([step("a"), step("b")], "a")).toEqual([]);
  });

  it("follows a chain transitively", () => {
    const steps = [
      step("a"),
      step("b", { dependsOn: ["a"] }),
      step("c", { dependsOn: ["b"] }),
    ];
    expect(downstreamStepIds(steps, "a").sort()).toEqual(["b", "c"]);
  });

  it("never reports the step itself", () => {
    const steps = [step("a"), step("b", { dependsOn: ["a"] })];
    expect(downstreamStepIds(steps, "a")).not.toContain("a");
  });

  /** A diamond must not report the rejoining step twice. */
  it("dedupes a diamond", () => {
    const steps = [
      step("brief"),
      step("design", { dependsOn: ["brief"] }),
      step("copy", { dependsOn: ["brief"] }),
      step("review", { dependsOn: ["design", "copy"] }),
    ];
    const out = downstreamStepIds(steps, "brief");
    expect(out.sort()).toEqual(["copy", "design", "review"]);
    expect(out.filter((id) => id === "review")).toHaveLength(1);
  });

  /** The template builder refuses cycles, but crafted data could still hold
   *  one — this must terminate rather than hang. */
  it("terminates on a cycle, and still excludes the starting step", () => {
    const steps = [
      step("a", { dependsOn: ["b"] }),
      step("b", { dependsOn: ["a"] }),
    ];
    expect(downstreamStepIds(steps, "a")).toEqual(["b"]);
  });
});

describe("runRisk", () => {
  it("reports an open past-due step as overdue", () => {
    const steps = [step("a", { dueAt: new Date(2026, 7, 10) })];
    expect(runRisk(steps, NOW).overdue).toEqual(["a"]);
  });

  it("never reports a closed step, however late", () => {
    const steps = [
      step("a", { status: "done", dueAt: new Date(2026, 6, 1) }),
      step("b", { status: "skipped", dueAt: new Date(2026, 6, 1) }),
    ];
    const risk = runRisk(steps, NOW);
    expect(risk.overdue).toEqual([]);
    expect(risk.atRisk).toEqual([]);
  });

  /**
   * The signal worth surfacing: this step is not late yet, but the thing it
   * waits on is, so it is going to be. By the time it goes overdue itself
   * it is too late to act on the cause.
   */
  it("flags a not-yet-late step waiting on an overdue one", () => {
    const steps = [
      step("late", { dueAt: new Date(2026, 7, 10) }),
      step("next", {
        status: "blocked",
        dueAt: new Date(2026, 8, 1),
        dependsOn: ["late"],
      }),
    ];
    const risk = runRisk(steps, NOW);
    expect(risk.overdue).toEqual(["late"]);
    expect(risk.atRisk).toEqual(["next"]);
  });

  it("propagates risk transitively down a chain", () => {
    const steps = [
      step("late", { dueAt: new Date(2026, 7, 10) }),
      step("b", { status: "blocked", dueAt: new Date(2026, 8, 1), dependsOn: ["late"] }),
      step("c", { status: "blocked", dueAt: new Date(2026, 8, 5), dependsOn: ["b"] }),
    ];
    expect(runRisk(steps, NOW).atRisk.sort()).toEqual(["b", "c"]);
  });

  /** A step counted as overdue must not also be counted as at risk — the
   *  two numbers are shown side by side and would double-count. */
  it("does not report an overdue step as also at risk", () => {
    const steps = [
      step("late", { dueAt: new Date(2026, 7, 10) }),
      step("alsoLate", { dueAt: new Date(2026, 7, 11), dependsOn: ["late"] }),
    ];
    const risk = runRisk(steps, NOW);
    expect(risk.overdue.sort()).toEqual(["alsoLate", "late"]);
    expect(risk.atRisk).toEqual([]);
  });

  it("does not flag a downstream step that is already closed", () => {
    const steps = [
      step("late", { dueAt: new Date(2026, 7, 10) }),
      step("done", {
        status: "done",
        dueAt: new Date(2026, 8, 1),
        dependsOn: ["late"],
      }),
    ];
    expect(runRisk(steps, NOW).atRisk).toEqual([]);
  });

  it("reports nothing for a healthy run", () => {
    const steps = [
      step("a", { dueAt: new Date(2026, 8, 1) }),
      step("b", { dueAt: new Date(2026, 8, 5), dependsOn: ["a"] }),
    ];
    const risk = runRisk(steps, NOW);
    expect(risk.overdue).toEqual([]);
    expect(risk.atRisk).toEqual([]);
  });
});

describe("rescheduledDates", () => {
  const steps = [
    step("late", { dueAt: new Date(2026, 7, 10) }),
    step("b", { status: "blocked", dueAt: new Date(2026, 7, 25), dependsOn: ["late"] }),
    step("c", { status: "blocked", dueAt: new Date(2026, 7, 30), dependsOn: ["b"] }),
  ];

  it("shifts every open downstream step by the given days", () => {
    const moves = rescheduledDates(steps, "late", 5);
    expect(moves).toHaveLength(2);
    const byId = new Map(moves.map((m) => [m.id, m.dueAt]));
    expect(byId.get("b")!.getDate()).toBe(30); // 25 Aug + 5
    expect(byId.get("c")!.getMonth()).toBe(8); // 30 Aug + 5 -> 4 Sep
    expect(byId.get("c")!.getDate()).toBe(4);
  });

  /** The step that slipped keeps its date: it is the evidence of the slip. */
  it("never moves the step that slipped", () => {
    expect(rescheduledDates(steps, "late", 5).map((m) => m.id)).not.toContain(
      "late",
    );
  });

  /** Rewriting when something actually happened, to tidy a chart, is a lie. */
  it("never moves a closed step", () => {
    const withClosed = [
      step("late", { dueAt: new Date(2026, 7, 10) }),
      step("done", {
        status: "done",
        dueAt: new Date(2026, 7, 25),
        dependsOn: ["late"],
      }),
    ];
    expect(rescheduledDates(withClosed, "late", 5)).toEqual([]);
  });

  it("is a no-op for zero days", () => {
    expect(rescheduledDates(steps, "late", 0)).toEqual([]);
  });

  it("can pull dates earlier with a negative shift", () => {
    const moves = rescheduledDates(steps, "late", -2);
    const b = moves.find((m) => m.id === "b")!;
    expect(b.dueAt.getDate()).toBe(23);
  });
});

describe("reanchoredDates (E9)", () => {
  const steps = [
    step("s1", { status: "done", dueAt: new Date(2026, 7, 10) }),
    step("s2", { status: "skipped", dueAt: new Date(2026, 7, 12) }),
    step("s3", { status: "ready", dueAt: new Date(2026, 7, 15) }),
    step("s4", { status: "in_progress", dueAt: new Date(2026, 7, 20) }),
    step("s5", { status: "blocked", dueAt: new Date(2026, 7, 25) }),
  ];

  it("shifts all open steps by days", () => {
    const moves = reanchoredDates(steps, 7);
    expect(moves.map((m) => m.id)).toEqual(["s3", "s4", "s5"]);
    const byId = new Map(moves.map((m) => [m.id, m.dueAt]));
    expect(byId.get("s3")!.getDate()).toBe(22); // 15 + 7
    expect(byId.get("s4")!.getDate()).toBe(27); // 20 + 7
    expect(byId.get("s5")!.getMonth()).toBe(8); // 25 Aug + 7 -> 1 Sep
    expect(byId.get("s5")!.getDate()).toBe(1);
  });

  it("preserves historical closed steps (done, skipped)", () => {
    const moves = reanchoredDates(steps, 10);
    const ids = moves.map((m) => m.id);
    expect(ids).not.toContain("s1");
    expect(ids).not.toContain("s2");
  });

  it("is a no-op for zero days", () => {
    expect(reanchoredDates(steps, 0)).toEqual([]);
  });

  it("can shift backwards for earlier anchor dates", () => {
    const moves = reanchoredDates(steps, -5);
    const s3 = moves.find((m) => m.id === "s3")!;
    expect(s3.dueAt.getDate()).toBe(10); // 15 - 5
  });
});
