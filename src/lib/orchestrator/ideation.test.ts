import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { runIdeationFlow, validateIdeas } from "./ideation";
import { DECLARED_ONLY_BRIEF } from "@/lib/ai/context/ideation";
import { DECLARED_ONLY_REASON } from "@/lib/ai/agents/strategy";
import { MIN_BASELINE_N } from "@/lib/scoring";
import { getBrandProfile } from "@/db/queries/brand";
import { getClientGoalById } from "@/db/queries/client-goals";
import { createIdeas } from "@/db/queries/ideas";
import {
  getBaselinePoints,
  similarPostsQuery,
  topMoversQuery,
} from "@/db/queries/posts";
import { routeAI } from "@/lib/ai/router";

// Only the DB queries and the model router are mocked; retrieval (with its
// min-N gate), the recipe, the Strategy agent, validation, and the
// orchestrator all run for real.
vi.mock("@/db/queries/brand", () => ({ getBrandProfile: vi.fn() }));
vi.mock("@/db/queries/client-goals", () => ({ getClientGoalById: vi.fn() }));
vi.mock("@/db/queries/ideas", () => ({ createIdeas: vi.fn() }));
vi.mock("@/db/queries/posts", () => ({
  getBaselinePoints: vi.fn(),
  similarPostsQuery: vi.fn(),
  topMoversQuery: vi.fn(),
}));
vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));

const profileMock = getBrandProfile as unknown as Mock;
const goalMock = getClientGoalById as unknown as Mock;
const createIdeasMock = createIdeas as unknown as Mock;
const baselineMock = getBaselinePoints as unknown as Mock;
const similarMock = similarPostsQuery as unknown as Mock;
const moversMock = topMoversQuery as unknown as Mock;
const routeAIMock = routeAI as unknown as Mock;

const IDENTITY = {
  voice: "Warm",
  tone: "Expert",
  audience: "Coffee lovers",
  pillars: ["Craft"],
  doNots: ["No discounts"],
  formats: ["reel"],
};
const DECLARED = {
  brandType: "educational_authority",
  mission: "Make specialty coffee approachable.",
  showcaseTheme: "Warm craft",
  tones: ["Warm"],
  pillars: ["Craft"],
  bannedWords: [],
  avoidTopics: [],
  colors: [],
  typography: null,
  logoUrl: null,
  links: {},
};

const POST_ID = "aaaabbbb-0000-0000-0000-000000000000";
const point = { value: 0.1, postedAt: new Date("2026-06-01") };
const PARAMS = { workspaceId: "ws_1", clientId: "c_1", topic: "summer launch" };

function ideaJson(citations: string[]) {
  return {
    hook: "Behind the roast",
    angle: "Show the process",
    format: "reel",
    why: { reason: "Process content over-performs", citations },
  };
}

/** Retrieval brief, embeddings, and the Strategy agent all go through routeAI. */
function mockModel(ideaCitations: string[] = [POST_ID, "forged_id"]) {
  routeAIMock.mockImplementation(
    async (task: { kind: string; system?: string; prompt?: string }) => {
      if (task.kind === "embed") return [[0.1, 0.2]];
      if (task.system?.includes("social performance analyst")) {
        return `Process reels win [aaaabbbb].`;
      }
      return JSON.stringify({ ideas: [ideaJson(ideaCitations), ideaJson([])] });
    },
  );
}

function agentCall() {
  return routeAIMock.mock.calls
    .map(([t]) => t)
    .find((t) => t.system?.includes("senior social content strategist"));
}

beforeEach(() => {
  for (const m of [profileMock, goalMock, createIdeasMock, baselineMock, similarMock, moversMock, routeAIMock]) {
    m.mockReset();
  }
  createIdeasMock.mockResolvedValue(undefined);
  goalMock.mockResolvedValue(null);
  similarMock.mockResolvedValue([]);
  moversMock.mockResolvedValue([]);
});

describe("runIdeationFlow (input → context → agent → validation → apply)", () => {
  it("first-party path: cites only real drivers and persists workspace-scoped rows", async () => {
    profileMock.mockResolvedValue({ declared: null, identity: IDENTITY });
    baselineMock.mockResolvedValue(Array(MIN_BASELINE_N + 5).fill(point));
    const driver = { id: POST_ID, caption: "c", direction: "up", magnitude: 0.9, format: "reel" };
    moversMock.mockImplementation(async (_w: string, _c: string, dir: string) =>
      dir === "up" ? [driver] : [],
    );
    mockModel();

    const result = await runIdeationFlow(PARAMS);

    expect(result).toMatchObject({ status: "completed", output: { count: 2 } });
    expect(createIdeasMock).toHaveBeenCalledTimes(1);
    const rows = createIdeasMock.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        workspaceId: "ws_1",
        clientId: "c_1",
        topic: "summer launch",
      });
    }
    // Hallucinated citation stripped; the real first-party id survives.
    expect(rows[0].citations).toEqual([POST_ID]);
    expect(rows[0].whyReason).toBe("Process content over-performs");
  });

  it("declared-only path: no embed call, honest reason, zero citations", async () => {
    profileMock.mockResolvedValue({ declared: DECLARED, identity: IDENTITY });
    baselineMock.mockResolvedValue(Array(MIN_BASELINE_N - 1).fill(point));
    mockModel([POST_ID]); // model tries to cite; must be discarded

    const result = await runIdeationFlow(PARAMS);

    expect(result.status).toBe("completed");
    expect(routeAIMock.mock.calls.some(([t]) => t.kind === "embed")).toBe(false);
    expect(agentCall().prompt).toContain(DECLARED_ONLY_BRIEF);
    const rows = createIdeasMock.mock.calls[0][0];
    for (const row of rows) {
      expect(row.whyReason).toBe(DECLARED_ONLY_REASON);
      expect(row.citations).toEqual([]);
    }
  });

  it("min-N gate without declared context: refuses, writes nothing, calls no model", async () => {
    profileMock.mockResolvedValue({ declared: null, identity: IDENTITY });
    baselineMock.mockResolvedValue(Array(3).fill(point));

    const result = await runIdeationFlow(PARAMS);

    expect(result).toEqual({
      status: "insufficient_context",
      state: "insufficient_baseline",
      sampleSize: 3,
    });
    expect(routeAIMock).not.toHaveBeenCalled();
    expect(createIdeasMock).not.toHaveBeenCalled();
  });

  it("no brand context: refuses before retrieval or any model call", async () => {
    profileMock.mockResolvedValue(null);

    const result = await runIdeationFlow(PARAMS);

    expect(result).toMatchObject({
      status: "insufficient_context",
      state: "missing_context",
    });
    expect(baselineMock).not.toHaveBeenCalled();
    expect(routeAIMock).not.toHaveBeenCalled();
    expect(createIdeasMock).not.toHaveBeenCalled();
  });

  it("threads a resolved client goal into the agent prompt", async () => {
    profileMock.mockResolvedValue({ declared: DECLARED, identity: IDENTITY });
    baselineMock.mockResolvedValue([]);
    goalMock.mockResolvedValue({ title: "Grow saves", hypothesis: null });
    mockModel([]);

    await runIdeationFlow({ ...PARAMS, goalId: "goal_1" });

    expect(goalMock).toHaveBeenCalledWith("ws_1", "c_1", "goal_1");
    expect(agentCall().prompt).toContain("Client goal: Grow saves.");
  });

  it("a malformed agent response propagates and nothing is persisted", async () => {
    profileMock.mockResolvedValue({ declared: DECLARED, identity: IDENTITY });
    baselineMock.mockResolvedValue([]);
    routeAIMock.mockResolvedValue("not json");

    await expect(runIdeationFlow(PARAMS)).rejects.toThrow();
    expect(createIdeasMock).not.toHaveBeenCalled();
  });
});

describe("validateIdeas", () => {
  const idea = (citations: string[]) => ({
    hook: "h",
    angle: "a",
    format: "reel",
    why: { reason: "r", citations },
  });
  const declaredCtx = {
    evidence: { mode: "declared_only", brief: "b" },
  } as never;
  const firstPartyCtx = {
    evidence: { mode: "first_party", brief: "b", drivers: [], citedPostIds: [] },
  } as never;

  it("rejects an empty proposal", () => {
    expect(validateIdeas([], firstPartyCtx).valid).toBe(false);
  });

  it("rejects citations in declared-only mode (never invent evidence)", () => {
    expect(validateIdeas([idea(["post_1"])], declaredCtx).valid).toBe(false);
    expect(validateIdeas([idea([])], declaredCtx)).toEqual({ valid: true });
  });

  it("allows citations in first-party mode", () => {
    expect(validateIdeas([idea(["post_1"])], firstPartyCtx)).toEqual({ valid: true });
  });
});
