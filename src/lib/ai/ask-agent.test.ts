import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  ASK_MAX_ITEMS,
  askInstamedia,
  buildAskPrompt,
  buildAskSystem,
  type AskGrounding,
} from "./ask-agent";
import { routeAI } from "@/lib/ai/router";

vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));
const routeAIMock = routeAI as unknown as Mock;

const GROUNDING: AskGrounding = {
  workspaceName: "Aurora Skincare",
  role: "member",
  clients: [{ name: "Aurora", status: "active" }],
  upcomingSlots: [
    {
      title: "Barrier repair myths",
      clientName: "Aurora",
      status: "approved",
      scheduledFor: new Date("2026-07-14T09:00:00Z"),
    },
  ],
  openTasks: [{ text: "Shoot reel b-roll", priority: "high" }],
  pendingApprovals: [{ title: "July carousel copy" }],
  newIdeas: [{ topic: "SPF reapplication", hook: "You're doing SPF wrong" }],
};

beforeEach(() => routeAIMock.mockReset());

describe("buildAskSystem", () => {
  it("scopes the assistant to the member's role and forbids invention and cross-workspace/pattern data", () => {
    const system = buildAskSystem("member");
    expect(system).toContain('"member"');
    expect(system).toContain("never invent");
    expect(system).toContain("other workspaces");
  });
});

describe("buildAskPrompt", () => {
  it("includes every grounding section plus the question", () => {
    const prompt = buildAskPrompt(GROUNDING, "What is scheduled next week?");
    expect(prompt).toContain("Workspace: Aurora Skincare");
    expect(prompt).toContain("Aurora (active)");
    expect(prompt).toContain("2026-07-14 · Aurora · Barrier repair myths");
    expect(prompt).toContain("[high] Shoot reel b-roll");
    expect(prompt).toContain("July carousel copy");
    expect(prompt).toContain("SPF reapplication — You're doing SPF wrong");
    expect(prompt).toContain("Question: What is scheduled next week?");
  });

  it("renders (none) for empty sections instead of dropping them", () => {
    const prompt = buildAskPrompt(
      { ...GROUNDING, openTasks: [], pendingApprovals: [] },
      "Anything pending?",
    );
    expect(prompt).toContain("Open team tasks:\n- (none)");
    expect(prompt).toContain("Pending approvals:\n- (none)");
  });

  it("caps each section at ASK_MAX_ITEMS to keep grounding token-bounded", () => {
    const many = Array.from({ length: ASK_MAX_ITEMS + 5 }, (_, i) => ({
      name: `Client ${i}`,
      status: "active",
    }));
    const prompt = buildAskPrompt({ ...GROUNDING, clients: many }, "Who?");
    expect(prompt).toContain(`Client ${ASK_MAX_ITEMS - 1}`);
    expect(prompt).not.toContain(`Client ${ASK_MAX_ITEMS}`);
  });
});

describe("askInstamedia", () => {
  it("routes a fast chat with the role-scoped system prompt and returns the answer", async () => {
    routeAIMock.mockResolvedValue("One post is scheduled for July 14.");
    const answer = await askInstamedia(GROUNDING, "What's next?");
    expect(answer).toBe("One post is scheduled for July 14.");
    const task = routeAIMock.mock.calls[0][0];
    expect(task.kind).toBe("chat");
    expect(task.system).toContain('"member"');
    expect(task.prompt).toContain("Question: What's next?");
    expect(task.tier).toBeUndefined();
  });
});
