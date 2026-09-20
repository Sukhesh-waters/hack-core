import { afterEach, describe, expect, it, vi } from "vitest";
import * as routerModule from "@/lib/ai/router";
import {
  generateTemplateDraft,
  SopTemplateAgentError,
  validateGeneratedGraph,
} from "./strategy";

type MockRouteAI = {
  mockResolvedValue: (val: string) => MockRouteAI;
  mockResolvedValueOnce: (val: string) => MockRouteAI;
  toHaveBeenCalledTimes: (n: number) => void;
};

function spyRouteAI(): MockRouteAI {
  return vi.spyOn(routerModule, "routeAI") as unknown as MockRouteAI;
}

describe("A1 — SOP Template (strategy agent)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const validJsonResponse = JSON.stringify({
    name: "Monthly Skincare Content Cycle",
    description: "End to end skincare campaign workflow",
    anchorLabel: "Publication day",
    steps: [
      {
        tempId: "s1",
        title: "Brief & Hook Ideation",
        description: "Draft initial hooks",
        dueOffsetDays: -7,
        gate: "none",
        creates: "content",
        assigneeRole: "member",
        dependsOnTempIds: [],
      },
      {
        tempId: "s2",
        title: "Compliance & Claims Review",
        description: "Check FDA claims",
        dueOffsetDays: -3,
        gate: "compliance",
        creates: "none",
        assigneeRole: "admin",
        dependsOnTempIds: ["s1"],
      },
    ],
  });

  it("parses valid JSON response from router", async () => {
    spyRouteAI().mockResolvedValue(validJsonResponse);

    const draft = await generateTemplateDraft({
      description: "Skincare content cycle",
      workspaceId: "ws_1",
    });

    expect(draft.name).toBe("Monthly Skincare Content Cycle");
    expect(draft.steps).toHaveLength(2);
    expect(draft.steps[0].dueOffsetDays).toBe(-7);
    expect(draft.steps[1].gate).toBe("compliance");
  });

  it("retries once when first attempt produces malformed JSON", async () => {
    const spy = spyRouteAI()
      .mockResolvedValueOnce("NOT JSON")
      .mockResolvedValueOnce(validJsonResponse);

    const draft = await generateTemplateDraft({
      description: "Skincare content cycle",
      workspaceId: "ws_1",
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(draft.name).toBe("Monthly Skincare Content Cycle");
  });

  it("throws SopTemplateAgentError when both retries fail", async () => {
    spyRouteAI().mockResolvedValue("INVALID JSON");

    await expect(
      generateTemplateDraft({
        description: "Skincare content cycle",
        workspaceId: "ws_1",
      }),
    ).rejects.toThrow(SopTemplateAgentError);
  });

  it("detects cyclic step dependencies with validateGeneratedGraph", () => {
    const cyclicSteps = [
      {
        tempId: "s1",
        title: "Step 1",
        dueOffsetDays: 0,
        gate: "none" as const,
        creates: "none" as const,
        dependsOnTempIds: ["s2"],
      },
      {
        tempId: "s2",
        title: "Step 2",
        dueOffsetDays: 1,
        gate: "none" as const,
        creates: "none" as const,
        dependsOnTempIds: ["s1"],
      },
    ];

    expect(validateGeneratedGraph(cyclicSteps)).toBe(false);
  });

  it("rejects cyclic dependencies and retries or throws", async () => {
    const cyclicJsonResponse = JSON.stringify({
      name: "Cyclic Flow",
      anchorLabel: "Launch",
      steps: [
        {
          tempId: "s1",
          title: "Step 1",
          dueOffsetDays: 0,
          gate: "none",
          creates: "none",
          dependsOnTempIds: ["s2"],
        },
        {
          tempId: "s2",
          title: "Step 2",
          dueOffsetDays: 1,
          gate: "none",
          creates: "none",
          dependsOnTempIds: ["s1"],
        },
      ],
    });

    spyRouteAI().mockResolvedValue(cyclicJsonResponse);

    await expect(
      generateTemplateDraft({
        description: "Cyclic description",
        workspaceId: "ws_1",
      }),
    ).rejects.toThrow(SopTemplateAgentError);
  });
});
