import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock DB
const mockInsertValues = vi.fn().mockResolvedValue([]);
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));
const mockSelectLimit = vi.fn().mockResolvedValue([{ id: "c1", name: "Acme Fitness", workspaceId: "ws1" }]);
const mockSelectWhere = vi.fn(() => ({ limit: mockSelectLimit }));
const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

const mockTx = {
  insert: mockInsert,
};

vi.mock("@/db", () => ({
  db: {
    select: () => mockSelect(),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(mockTx),
  },
}));

vi.mock("@/db/queries/brand", () => ({
  getBrandProfile: vi.fn().mockResolvedValue({
    identity: {
      voice: "Bold",
      tone: "Direct",
      audience: "Athletes",
      pillars: ["Workouts", "Nutrition"],
      doNots: ["Fads"],
    },
  }),
}));

vi.mock("@/db/queries/workflow-seed", () => ({
  ensureContentWorkflow: vi.fn().mockResolvedValue({ id: "wf_1" }),
  initialStateQuery: vi.fn().mockResolvedValue({ id: "state_draft", name: "Draft" }),
}));

vi.mock("@/db/queries/sop", () => ({
  listSopTemplates: vi.fn().mockResolvedValue([]),
  loadSopTemplate: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/db/queries/memberships", () => ({
  listWorkspaceMembers: vi.fn().mockResolvedValue([{ userId: "u1", role: "admin" }]),
}));

vi.mock("@/lib/ai/ideation-agent", () => ({
  generateIdeas: vi.fn().mockResolvedValue([
    {
      hook: "Stop doing cardio before weights",
      angle: "Cardio timing myth",
      format: "reel",
      why: { reason: "High engagement myth-bust", citations: [] },
    },
    {
      hook: "3 High-Protein Breakfasts under 5 mins",
      angle: "Quick breakfast meal prep",
      format: "carousel",
      why: { reason: "High saves rate for recipes", citations: [] },
    },
  ]),
}));

vi.mock("@/lib/ai/generation-agent", () => ({
  generateDraft: vi.fn().mockResolvedValue({
    caption: "Here is why cardio timing matters...",
    script: "Hook: Stop doing cardio first. Step 1: Warm up with dynamic stretches...",
    hashtags: ["#fitness", "#gymtips"],
    cta: "Save this for your next gym session!",
  }),
  formatDraftBody: vi.fn((d: { caption: string; script: string; hashtags: string[]; cta: string }) =>
    `## Caption\n${d.caption}\n\n## Script\n${d.script}\n\n## Hashtags\n${d.hashtags.join(" ")}\n\n## CTA\n${d.cta}`
  ),
  parseDraftBody: vi.fn(),
}));

vi.mock("@/lib/ai/compliance-agent", () => ({
  checkCompliance: vi.fn().mockResolvedValue({
    verdict: "pass",
    violations: [],
  }),
  enforceCompliance: vi.fn(),
}));

vi.mock("@/lib/events/dispatch", () => ({
  emitDomainEvent: vi.fn().mockResolvedValue(undefined),
}));

import { launchCampaignSprint } from "./sprint-engine";
import { checkCompliance } from "@/lib/ai/compliance-agent";
import { emitDomainEvent } from "@/lib/events/dispatch";
import { loadSopTemplate, type LoadedSopTemplate } from "@/db/queries/sop";

describe("launchCampaignSprint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("orchestrates client verification, ideation, draft generation, and SOP pipeline assembly", async () => {
    const result = await launchCampaignSprint({
      workspaceId: "ws1",
      clientId: "c1",
      theme: "Summer Fit Launch",
      targetCount: 2,
      durationDays: 7,
      userId: "u1",
    });

    expect(result.ok).toBe(true);
    expect(result.runName).toBe("Summer Fit Launch — Sprint");
    expect(result.posts).toHaveLength(2);
    expect(result.posts[0].type).toBe("reel");
    expect(result.posts[1].type).toBe("carousel");
    expect(result.posts[0].complianceStatus).toBe("passed");

    // SOP run and steps inserted in transaction
    expect(mockInsert).toHaveBeenCalled();

    // Verify domain events emitted for each post with adhoc_sprint fallback
    expect(emitDomainEvent).toHaveBeenCalledTimes(2);
    expect(emitDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          source: "adhoc_sprint",
          templateId: null,
        }),
      }),
    );
  });

  it("fails closed to 'pending' if compliance check throws an error", async () => {
    vi.mocked(checkCompliance).mockRejectedValueOnce(new Error("LLM Rate Limited"));

    const result = await launchCampaignSprint({
      workspaceId: "ws1",
      clientId: "c1",
      theme: "Failover Test",
      targetCount: 1,
      durationDays: 7,
      userId: "u1",
    });

    expect(result.ok).toBe(true);
    expect(result.posts[0].complianceStatus).toBe("pending");
    expect(result.posts[0].complianceViolationsCount).toBe(1);
  });

  it("instantiates canonical template steps and sets template provenance when templateId is provided", async () => {
    vi.mocked(loadSopTemplate).mockResolvedValueOnce({
      template: {
        id: "tmpl_1",
        workspaceId: "ws1",
        name: "Campaign Template",
        description: "Official launch process",
        anchorLabel: "Launch date",
        archivedAt: null,
        createdAt: new Date(),
      } as unknown as LoadedSopTemplate["template"],
      steps: [
        {
          id: "step_tmpl_1",
          templateId: "tmpl_1",
          position: 0,
          title: "Step 1: Brief review",
          description: "Review brief",
          assigneeRule: { kind: "user", value: "u1" },
          dueOffsetDays: -5,
          gate: "none",
          creates: "content",
          completesWhen: { kind: "manual" },
          dependsOn: [],
        } as unknown as LoadedSopTemplate["steps"][number],
        {
          id: "step_tmpl_2",
          templateId: "tmpl_1",
          position: 1,
          title: "Step 2: Sign-off",
          description: "Client sign off",
          assigneeRule: { kind: "role", value: "admin" },
          dueOffsetDays: -1,
          gate: "approval",
          creates: "none",
          completesWhen: { kind: "manual" },
          dependsOn: ["step_tmpl_1"],
        } as unknown as LoadedSopTemplate["steps"][number],
      ],
    });

    const result = await launchCampaignSprint({
      workspaceId: "ws1",
      clientId: "c1",
      theme: "Template Sprint",
      templateId: "tmpl_1",
      targetCount: 2,
      durationDays: 7,
      userId: "u1",
    });

    expect(result.ok).toBe(true);
    expect(loadSopTemplate).toHaveBeenCalledWith("ws1", "tmpl_1");
    expect(emitDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          source: "template_sprint",
          templateId: "tmpl_1",
        }),
      }),
    );
  });
});
