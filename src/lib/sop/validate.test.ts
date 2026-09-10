import { describe, expect, it } from "vitest";
import type { SopRunRow, SopRunStepRow } from "@/db/queries/sop";
import { isWeekend, validateRun } from "./validate";

function makeRun(overrides?: Partial<SopRunRow>): SopRunRow {
  return {
    id: "run_1",
    templateId: "tpl_1",
    clientId: "c_1",
    clientName: "Acme Corp",
    name: "Q3 Campaign Launch",
    anchorDate: new Date("2026-08-10T09:00:00Z"), // Monday
    status: "active",
    createdAt: new Date("2026-08-01T09:00:00Z"),
    completedAt: null,
    ...overrides,
  };
}

function makeStep(overrides?: Partial<SopRunStepRow>): SopRunStepRow {
  return {
    id: "step_1",
    runId: "run_1",
    position: 0,
    title: "Draft copy",
    description: "Write main copy",
    assigneeId: "user_1",
    assigneeRole: "member",
    dueAt: new Date("2026-08-12T09:00:00Z"), // Wednesday
    status: "ready",
    gate: "none",
    creates: "none",
    completesWhen: { kind: "manual" },
    dependsOn: [],
    linkedType: null,
    linkedId: null,
    rejectionReason: null,
    completedAt: null,
    ...overrides,
  };
}

describe("A2 — SOP Run Validation", () => {
  it("identifies weekend due dates with isWeekend", () => {
    expect(isWeekend(new Date("2026-08-08"))).toBe(true); // Saturday
    expect(isWeekend(new Date("2026-08-09"))).toBe(true); // Sunday
    expect(isWeekend(new Date("2026-08-10"))).toBe(false); // Monday
  });

  it("returns no findings for a clean run", () => {
    const run = makeRun();
    const steps = [makeStep()];
    const findings = validateRun({ run, steps, now: new Date("2026-08-01") });
    expect(findings).toEqual([]);
  });

  it("flags an anchor date in the past at run start", () => {
    const run = makeRun({ anchorDate: new Date("2026-07-01") });
    const steps = [makeStep()];
    const findings = validateRun({ run, steps, now: new Date("2026-08-01") });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("in the past");
  });

  it("flags unassigned steps with no role rule", () => {
    const run = makeRun();
    const steps = [makeStep({ assigneeId: null, assigneeRole: null })];
    const findings = validateRun({ run, steps, now: new Date("2026-08-01") });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].stepTitle).toBe("Draft copy");
    expect(findings[0].message).toContain("no assigned owner or required role");
  });

  it("flags steps due on weekends", () => {
    const run = makeRun();
    const steps = [makeStep({ dueAt: new Date("2026-08-08T09:00:00Z") })]; // Saturday
    const findings = validateRun({ run, steps, now: new Date("2026-08-01") });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("Saturday");
  });

  it("flags compliance gates with no linked draft", () => {
    const run = makeRun();
    const steps = [
      makeStep({
        gate: "compliance",
        linkedType: null,
        linkedId: null,
      }),
    ];
    const findings = validateRun({ run, steps, now: new Date("2026-08-01") });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain("compliance gate but no draft linked");
  });

  it("flags dependent steps due before their prerequisites", () => {
    const run = makeRun();
    const prereq = makeStep({
      id: "s1",
      title: "Prerequisite step",
      dueAt: new Date("2026-08-14T09:00:00Z"), // Friday
    });
    const dependent = makeStep({
      id: "s2",
      title: "Dependent step",
      dueAt: new Date("2026-08-10T09:00:00Z"), // Monday (earlier than prereq!)
      dependsOn: ["s1"],
    });

    const findings = validateRun({
      run,
      steps: [prereq, dependent],
      now: new Date("2026-08-01"),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].stepTitle).toBe("Dependent step");
    expect(findings[0].message).toContain("is due before its prerequisite");
  });

  it("ignores completed or skipped steps", () => {
    const run = makeRun();
    const steps = [
      makeStep({
        status: "done",
        dueAt: new Date("2026-08-08T09:00:00Z"), // Saturday, but step is DONE
      }),
    ];
    const findings = validateRun({ run, steps, now: new Date("2026-08-01") });
    expect(findings).toEqual([]);
  });
});
