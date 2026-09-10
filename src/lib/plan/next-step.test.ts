import { describe, expect, it } from "vitest";
import type { LoadedWorkflow } from "@/lib/workflow/engine";
import {
  deriveHappyPath,
  nextStepChipText,
  remainingSteps,
} from "./next-step";

/**
 * Fixture matching the default content workflow from
 * src/lib/workflow/defaults.ts — Brief → In progress → Internal review → Done,
 * with a revision detour (Internal review ↔ Revision).
 */
function defaultWorkflow(): LoadedWorkflow {
  return {
    id: "wf_default",
    name: "Content",
    states: [
      { id: "s1", key: "brief", name: "Brief", category: "todo", colorKey: "slate", position: 0, wipLimit: null, legacyStage: "brief" },
      { id: "s2", key: "in_progress", name: "In progress", category: "doing", colorKey: "sky", position: 1, wipLimit: null, legacyStage: "in_progress" },
      { id: "s3", key: "internal_review", name: "Internal review", category: "doing", colorKey: "amber", position: 2, wipLimit: null, legacyStage: "internal_review" },
      { id: "s4", key: "revision", name: "Revision", category: "doing", colorKey: "rose", position: 3, wipLimit: null, legacyStage: "revision" },
      { id: "s5", key: "done", name: "Done", category: "done", colorKey: "emerald", position: 4, wipLimit: null, legacyStage: "done" },
    ],
    transitions: [
      { id: "t0", fromStateId: null, toStateId: "s1", name: "Create", position: 0, conditions: [], validators: [], postActions: [] },
      { id: "t1", fromStateId: "s1", toStateId: "s2", name: "Start", position: 1, conditions: [], validators: [], postActions: [] },
      { id: "t2", fromStateId: "s2", toStateId: "s3", name: "Submit for review", position: 2, conditions: [], validators: [], postActions: [] },
      { id: "t3", fromStateId: "s3", toStateId: "s5", name: "Mark done", position: 3, conditions: [], validators: [], postActions: [] },
      { id: "t4", fromStateId: "s3", toStateId: "s4", name: "Send back", position: 4, conditions: [], validators: [], postActions: [] },
      { id: "t5", fromStateId: "s4", toStateId: "s3", name: "Resubmit", position: 5, conditions: [], validators: [], postActions: [] },
      { id: "t6", fromStateId: "s5", toStateId: "s2", name: "Reopen", position: 6, conditions: [], validators: [], postActions: [] },
    ],
  };
}

/**
 * Custom workflow with non-default state names to prove the chip text
 * is graph-derived, not hardcoded.
 */
function customWorkflow(): LoadedWorkflow {
  return {
    id: "wf_custom",
    name: "Custom Pipeline",
    states: [
      { id: "c1", key: "backlog", name: "Backlog", category: "todo", colorKey: "slate", position: 0, wipLimit: null, legacyStage: null },
      { id: "c2", key: "design", name: "Design", category: "doing", colorKey: "sky", position: 1, wipLimit: null, legacyStage: null },
      { id: "c3", key: "build", name: "Build", category: "doing", colorKey: "amber", position: 2, wipLimit: null, legacyStage: null },
      { id: "c4", key: "shipped", name: "Shipped", category: "done", colorKey: "emerald", position: 3, wipLimit: null, legacyStage: null },
    ],
    transitions: [
      { id: "ct0", fromStateId: null, toStateId: "c1", name: "Create", position: 0, conditions: [], validators: [], postActions: [] },
      { id: "ct1", fromStateId: "c1", toStateId: "c2", name: "Start design", position: 1, conditions: [], validators: [], postActions: [] },
      { id: "ct2", fromStateId: "c2", toStateId: "c3", name: "Start build", position: 2, conditions: [], validators: [], postActions: [] },
      { id: "ct3", fromStateId: "c3", toStateId: "c4", name: "Ship", position: 3, conditions: [], validators: [], postActions: [] },
    ],
  };
}

/** Edge case: workflow with no states. */
function emptyWorkflow(): LoadedWorkflow {
  return { id: "wf_empty", name: "Empty", states: [], transitions: [] };
}

describe("deriveHappyPath", () => {
  it("produces the full default pipeline, skipping the revision detour", () => {
    const path = deriveHappyPath(defaultWorkflow());
    expect(path).toEqual(["Brief", "In progress", "Internal review", "Done"]);
  });

  it("skips the Revision state because Internal review → Done is a higher-category edge", () => {
    const path = deriveHappyPath(defaultWorkflow());
    expect(path).not.toContain("Revision");
  });

  it("produces a custom pipeline from a custom workflow", () => {
    const path = deriveHappyPath(customWorkflow());
    expect(path).toEqual(["Backlog", "Design", "Build", "Shipped"]);
  });

  it("returns empty array for a workflow with no states", () => {
    expect(deriveHappyPath(emptyWorkflow())).toEqual([]);
  });
});

describe("nextStepChipText", () => {
  it("joins the default happy path with arrows", () => {
    const text = nextStepChipText(defaultWorkflow());
    expect(text).toBe("Brief → In progress → Internal review → Done");
  });

  it("joins a custom pipeline with arrows", () => {
    const text = nextStepChipText(customWorkflow());
    expect(text).toBe("Backlog → Design → Build → Shipped");
  });

  it("returns fallback text for empty workflows", () => {
    expect(nextStepChipText(emptyWorkflow())).toBe("No pipeline configured");
  });
});

describe("remainingSteps", () => {
  it("returns remaining steps from In progress", () => {
    const wf = defaultWorkflow();
    const steps = remainingSteps(wf, "s2"); // In progress
    expect(steps).toEqual(["Internal review", "Done"]);
  });

  it("returns remaining steps from Brief", () => {
    const wf = defaultWorkflow();
    const steps = remainingSteps(wf, "s1"); // Brief
    expect(steps).toEqual(["In progress", "Internal review", "Done"]);
  });

  it("returns empty for Done state", () => {
    const wf = defaultWorkflow();
    expect(remainingSteps(wf, "s5")).toEqual([]);
  });

  it("returns empty for unknown state", () => {
    const wf = defaultWorkflow();
    expect(remainingSteps(wf, "nonexistent")).toEqual([]);
  });
});
