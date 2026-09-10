import { afterEach, describe, expect, it, vi } from "vitest";
import type { SopRunRow, SopRunStepRow } from "@/db/queries/sop";
import * as routerModule from "@/lib/ai/router";
import {
  buildSuggestPrompt,
  suggestNextAction,
} from "./sop-suggest-agent";

function makeRun(): SopRunRow {
  return {
    id: "run_1",
    templateId: "tpl_1",
    clientId: "c_1",
    clientName: "Acme Corp",
    name: "Campaign Launch",
    anchorDate: new Date("2026-08-10"),
    status: "active",
    createdAt: new Date("2026-08-01"),
    completedAt: null,
  };
}

function makeStep(overrides?: Partial<SopRunStepRow>): SopRunStepRow {
  return {
    id: "step_1",
    runId: "run_1",
    position: 0,
    title: "Review copy",
    description: null,
    assigneeId: "user_1",
    assigneeRole: "member",
    dueAt: new Date("2026-08-05"),
    status: "blocked",
    gate: "none",
    creates: "none",
    completesWhen: { kind: "manual" },
    dependsOn: ["step_0"],
    linkedType: null,
    linkedId: null,
    rejectionReason: null,
    completedAt: null,
    ...overrides,
  };
}

describe("A3 — SOP Suggest Agent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null for completed or skipped steps without calling router", async () => {
    const spy = vi.spyOn(routerModule, "routeAI");
    const run = makeRun();
    const step = makeStep({ status: "done" });

    const result = await suggestNextAction({
      step,
      allSteps: [step],
      run,
      now: new Date("2026-08-01"),
    });

    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns null for healthy step on schedule with no blockers", async () => {
    const spy = vi.spyOn(routerModule, "routeAI");
    const run = makeRun();
    const step = makeStep({
      status: "ready",
      dueAt: new Date("2026-08-10"),
      dependsOn: [],
    });

    const result = await suggestNextAction({
      step,
      allSteps: [step],
      run,
      now: new Date("2026-08-01"),
    });

    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("builds prompt with blocker information for blocked step", () => {
    const run = makeRun();
    const blocker = makeStep({
      id: "step_0",
      title: "Draft copy",
      status: "in_progress",
      dueAt: new Date("2026-08-03"),
      assigneeId: "user_2",
    });
    const blockedStep = makeStep({
      id: "step_1",
      title: "Review copy",
      status: "blocked",
      dependsOn: ["step_0"],
    });

    const prompt = buildSuggestPrompt({
      step: blockedStep,
      allSteps: [blocker, blockedStep],
      run,
      now: new Date("2026-08-01"),
    });

    expect(prompt).toContain('Target Step: "Review copy"');
    expect(prompt).toContain('Step "Draft copy"');
    expect(prompt).toContain("status: in_progress");
  });

  it("calls routeAI fast tier and returns structured suggestion for blocked step", async () => {
    const mockResponse = JSON.stringify({
      action: "Ping user_2 to complete 'Draft copy'",
      reason: "Step 'Review copy' is blocked waiting on 'Draft copy' which is currently in_progress.",
      urgency: "high",
    });

    (vi.spyOn(routerModule, "routeAI") as unknown as { mockResolvedValue: (val: string) => void }).mockResolvedValue(mockResponse);

    const run = makeRun();
    const blocker = makeStep({
      id: "step_0",
      title: "Draft copy",
      status: "in_progress",
    });
    const blockedStep = makeStep({
      id: "step_1",
      title: "Review copy",
      status: "blocked",
      dependsOn: ["step_0"],
    });

    const suggestion = await suggestNextAction({
      step: blockedStep,
      allSteps: [blocker, blockedStep],
      run,
      now: new Date("2026-08-01"),
    });

    expect(suggestion).not.toBeNull();
    expect(suggestion?.urgency).toBe("high");
    expect(suggestion?.action).toContain("Ping user_2");
  });
});
