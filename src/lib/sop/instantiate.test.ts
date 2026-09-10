import { describe, expect, it } from "vitest";
import type { SopAssigneeRule } from "@/db/schema";
import {
  addDays,
  instantiateRun,
  isRunComplete,
  startOfDay,
  reblockedStepIds,
  unblockedStepIds,
  type TemplateStepLike,
} from "./instantiate";

const ANCHOR = new Date(2026, 7, 20); // 20 Aug 2026, local midnight

function step(
  id: string,
  overrides: Partial<TemplateStepLike> = {},
): TemplateStepLike {
  return {
    id,
    position: 0,
    title: id,
    description: null,
    assigneeRule: { kind: "unassigned" } as SopAssigneeRule,
    dueOffsetDays: 0,
    gate: "none",
    creates: "none",
    dependsOn: [],
    ...overrides,
  };
}

/** Deterministic ids so remapping is assertable. */
function counterIds() {
  let n = 0;
  return () => `run_step_${++n}`;
}

const everyoneIsMember = () => true;

describe("addDays", () => {
  it("moves calendar days forward and back", () => {
    expect(addDays(new Date(2026, 7, 20), 5).getDate()).toBe(25);
    expect(addDays(new Date(2026, 7, 20), -6).getDate()).toBe(14);
  });

  it("rolls over a month boundary", () => {
    const d = addDays(new Date(2026, 7, 30), 5); // 30 Aug + 5
    expect(d.getMonth()).toBe(8); // September
    expect(d.getDate()).toBe(4);
  });

  /**
   * The DST trap: adding 86_400_000ms across a clock change lands an hour
   * off, which silently moves a due date to the previous or next day.
   * Calendar arithmetic must not.
   */
  it("keeps the same wall-clock hour across a DST boundary", () => {
    const beforeDst = new Date(2026, 2, 6, 12, 0, 0); // 6 Mar, midday
    const after = addDays(beforeDst, 14); // crosses US DST start
    expect(after.getHours()).toBe(12);
    expect(after.getDate()).toBe(20);
  });

  it("does not mutate its input", () => {
    const original = new Date(2026, 7, 20);
    addDays(original, 10);
    expect(original.getDate()).toBe(20);
  });
});

describe("startOfDay", () => {
  it("strips the time so two runs started at different hours agree", () => {
    const morning = startOfDay(new Date(2026, 7, 20, 9, 30));
    const evening = startOfDay(new Date(2026, 7, 20, 23, 59));
    expect(morning.getTime()).toBe(evening.getTime());
    expect(morning.getHours()).toBe(0);
  });
});

describe("instantiateRun — dates", () => {
  it("dates each step relative to the anchor", () => {
    const steps = instantiateRun({
      steps: [
        step("brief", { dueOffsetDays: -14 }),
        step("launch", { dueOffsetDays: 0 }),
        step("recap", { dueOffsetDays: 3 }),
      ],
      anchorDate: ANCHOR,
      isMember: everyoneIsMember,
      newId: counterIds(),
    });

    expect(steps[0].dueAt.getDate()).toBe(6); // 20 Aug - 14
    expect(steps[1].dueAt.getDate()).toBe(20);
    expect(steps[2].dueAt.getDate()).toBe(23);
  });

  it("normalises the anchor to midnight regardless of when it was started", () => {
    const steps = instantiateRun({
      steps: [step("a", { dueOffsetDays: 0 })],
      anchorDate: new Date(2026, 7, 20, 16, 45),
      isMember: everyoneIsMember,
      newId: counterIds(),
    });
    expect(steps[0].dueAt.getHours()).toBe(0);
  });
});

describe("instantiateRun — dependency remapping", () => {
  it("points dependencies at RUN step ids, not template step ids", () => {
    const steps = instantiateRun({
      steps: [step("brief"), step("creative", { dependsOn: ["brief"] })],
      anchorDate: ANCHOR,
      isMember: everyoneIsMember,
      newId: counterIds(),
    });

    const brief = steps.find((s) => s.templateStepId === "brief")!;
    const creative = steps.find((s) => s.templateStepId === "creative")!;
    expect(creative.dependsOn).toEqual([brief.id]);
    // The template's own id must not survive into the run graph.
    expect(creative.dependsOn).not.toContain("brief");
  });

  it("remaps a diamond — two parallel branches rejoining", () => {
    const steps = instantiateRun({
      steps: [
        step("brief"),
        step("design", { dependsOn: ["brief"] }),
        step("copy", { dependsOn: ["brief"] }),
        step("review", { dependsOn: ["design", "copy"] }),
      ],
      anchorDate: ANCHOR,
      isMember: everyoneIsMember,
      newId: counterIds(),
    });
    const byTemplate = new Map(steps.map((s) => [s.templateStepId, s]));
    expect(byTemplate.get("review")!.dependsOn.sort()).toEqual(
      [byTemplate.get("design")!.id, byTemplate.get("copy")!.id].sort(),
    );
  });

  /** A dangling id can never complete, so keeping it would block its
   *  dependent for the life of the run. */
  it("drops a dependency naming a step outside the template", () => {
    const steps = instantiateRun({
      steps: [step("a", { dependsOn: ["ghost"] })],
      anchorDate: ANCHOR,
      isMember: everyoneIsMember,
      newId: counterIds(),
    });
    expect(steps[0].dependsOn).toEqual([]);
    // …and with nothing left to wait on, it is actionable rather than stuck.
    expect(steps[0].status).toBe("ready");
  });
});

describe("instantiateRun — initial status", () => {
  it("marks a step with no dependencies ready", () => {
    const steps = instantiateRun({
      steps: [step("a")],
      anchorDate: ANCHOR,
      isMember: everyoneIsMember,
      newId: counterIds(),
    });
    expect(steps[0].status).toBe("ready");
  });

  it("marks a step with dependencies blocked", () => {
    const steps = instantiateRun({
      steps: [step("a"), step("b", { dependsOn: ["a"] })],
      anchorDate: ANCHOR,
      isMember: everyoneIsMember,
      newId: counterIds(),
    });
    expect(steps.find((s) => s.templateStepId === "b")!.status).toBe("blocked");
  });
});

describe("instantiateRun — assignee resolution", () => {
  it("assigns a named user who is still a member", () => {
    const steps = instantiateRun({
      steps: [step("a", { assigneeRule: { kind: "user", value: "user_1" } })],
      anchorDate: ANCHOR,
      isMember: (id) => id === "user_1",
      newId: counterIds(),
    });
    expect(steps[0].assigneeId).toBe("user_1");
    expect(steps[0].assigneeRole).toBeNull();
  });

  /**
   * Assigning to someone who left makes the work invisible to everyone who
   * could actually do it — worse than showing it unowned.
   */
  it("leaves a named user unassigned once they've left the workspace", () => {
    const steps = instantiateRun({
      steps: [step("a", { assigneeRule: { kind: "user", value: "gone" } })],
      anchorDate: ANCHOR,
      isMember: () => false,
      newId: counterIds(),
    });
    expect(steps[0].assigneeId).toBeNull();
  });

  /**
   * The deliberate non-choice: a role rule records the role and picks nobody.
   * Auto-assigning an arbitrary admin gives dated work to someone who never
   * agreed to it, and would pick differently depending on row order.
   */
  it("records the role and assigns nobody for a role rule", () => {
    const steps = instantiateRun({
      steps: [step("a", { assigneeRule: { kind: "role", value: "admin" } })],
      anchorDate: ANCHOR,
      isMember: everyoneIsMember,
      newId: counterIds(),
    });
    expect(steps[0].assigneeId).toBeNull();
    expect(steps[0].assigneeRole).toBe("admin");
  });

  it("leaves both empty for an unassigned rule", () => {
    const steps = instantiateRun({
      steps: [step("a")],
      anchorDate: ANCHOR,
      isMember: everyoneIsMember,
      newId: counterIds(),
    });
    expect(steps[0].assigneeId).toBeNull();
    expect(steps[0].assigneeRole).toBeNull();
  });
});

describe("instantiateRun — snapshot fidelity", () => {
  it("copies title, gate, creates and position off the template", () => {
    const steps = instantiateRun({
      steps: [
        step("a", {
          position: 3,
          title: "Client sign-off",
          description: "Needs the deck",
          gate: "approval",
          creates: "ticket",
        }),
      ],
      anchorDate: ANCHOR,
      isMember: everyoneIsMember,
      newId: counterIds(),
    });
    expect(steps[0]).toMatchObject({
      position: 3,
      title: "Client sign-off",
      description: "Needs the deck",
      gate: "approval",
      creates: "ticket",
      templateStepId: "a",
    });
  });

  it("produces one run step per template step", () => {
    const steps = instantiateRun({
      steps: [step("a"), step("b"), step("c")],
      anchorDate: ANCHOR,
      isMember: everyoneIsMember,
      newId: counterIds(),
    });
    expect(steps).toHaveLength(3);
    expect(new Set(steps.map((s) => s.id)).size).toBe(3);
  });

  it("handles a template with no steps without inventing any", () => {
    expect(
      instantiateRun({
        steps: [],
        anchorDate: ANCHOR,
        isMember: everyoneIsMember,
        newId: counterIds(),
      }),
    ).toEqual([]);
  });
});

describe("unblockedStepIds", () => {
  it("unblocks a step once its only dependency is done", () => {
    expect(
      unblockedStepIds([
        { id: "a", status: "done", dependsOn: [] },
        { id: "b", status: "blocked", dependsOn: ["a"] },
      ]),
    ).toEqual(["b"]);
  });

  it("keeps a step blocked while any dependency is outstanding", () => {
    expect(
      unblockedStepIds([
        { id: "a", status: "done", dependsOn: [] },
        { id: "b", status: "ready", dependsOn: [] },
        { id: "c", status: "blocked", dependsOn: ["a", "b"] },
      ]),
    ).toEqual([]);
  });

  /**
   * Skipping is a decision that a step will never happen. Treating it as
   * unmet would strand everything downstream for the rest of the run.
   */
  it("treats a skipped dependency as closed", () => {
    expect(
      unblockedStepIds([
        { id: "a", status: "skipped", dependsOn: [] },
        { id: "b", status: "blocked", dependsOn: ["a"] },
      ]),
    ).toEqual(["b"]);
  });

  it("never returns a step that is already actionable or finished", () => {
    expect(
      unblockedStepIds([
        { id: "a", status: "done", dependsOn: [] },
        { id: "b", status: "ready", dependsOn: ["a"] },
        { id: "c", status: "in_progress", dependsOn: ["a"] },
        { id: "d", status: "done", dependsOn: ["a"] },
      ]),
    ).toEqual([]);
  });

  it("unblocks several dependents of one completed step at once", () => {
    expect(
      unblockedStepIds([
        { id: "a", status: "done", dependsOn: [] },
        { id: "b", status: "blocked", dependsOn: ["a"] },
        { id: "c", status: "blocked", dependsOn: ["a"] },
      ]).sort(),
    ).toEqual(["b", "c"]);
  });
});

describe("reblockedStepIds", () => {
  it("re-blocks a ready step when its prerequisite is no longer done/skipped", () => {
    expect(
      reblockedStepIds([
        { id: "a", status: "ready", dependsOn: [] },
        { id: "b", status: "ready", dependsOn: ["a"] },
      ]),
    ).toEqual(["b"]);
  });

  it("does not re-block steps whose dependencies remain satisfied", () => {
    expect(
      reblockedStepIds([
        { id: "a", status: "done", dependsOn: [] },
        { id: "b", status: "ready", dependsOn: ["a"] },
      ]),
    ).toEqual([]);
  });

  it("does not touch steps that are already in_progress or done", () => {
    expect(
      reblockedStepIds([
        { id: "a", status: "ready", dependsOn: [] },
        { id: "b", status: "in_progress", dependsOn: ["a"] },
        { id: "c", status: "done", dependsOn: ["a"] },
      ]),
    ).toEqual([]);
  });
});

describe("isRunComplete", () => {
  it("is true when every step is done or skipped", () => {
    expect(
      isRunComplete([{ status: "done" }, { status: "skipped" }]),
    ).toBe(true);
  });

  it("is false while anything is outstanding", () => {
    expect(isRunComplete([{ status: "done" }, { status: "ready" }])).toBe(
      false,
    );
  });

  /** An empty run is not a finished run — it never started. */
  it("is false for a run with no steps", () => {
    expect(isRunComplete([])).toBe(false);
  });
});
