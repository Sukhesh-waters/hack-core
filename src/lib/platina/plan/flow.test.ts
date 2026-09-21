import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { REVIEW_UNAVAILABLE_FEEDBACK, runPlanFlow } from "./flow";
import {
  getBrainChunksByIds,
  getBrand,
  getWorkspaceConfig,
  insertPlan,
  lexicalBrainChunksQuery,
  listCompetitorsOf,
  listPlanLessons,
  listSignalIdsForBrands,
  listSignalProvenance,
  similarBrainChunksQuery,
} from "@/db/queries/platina";
import { embedText } from "@/lib/platina/embed";
import { routeAI } from "@/lib/ai/router";

// Only the DB and the model router are mocked; the recipe, planner,
// validation, reviewer and orchestrator all run for real.
vi.mock("@/db/queries/platina", () => ({
  listPlanLessons: vi.fn(),
  insertPlan: vi.fn(),
  getWorkspaceConfig: vi.fn(),
  similarBrainChunksQuery: vi.fn(),
  lexicalBrainChunksQuery: vi.fn(),
  getBrainChunksByIds: vi.fn(),
  listSignalProvenance: vi.fn(),
  getBrand: vi.fn(),
  listCompetitorsOf: vi.fn(),
  listSignalIdsForBrands: vi.fn(),
  listWorkspaceWideSignalIds: vi.fn().mockResolvedValue([]),
}));
// The rerank pass is its own unit; here it keeps the fused order.
vi.mock("@/lib/platina/rerank", () => ({
  rerankCandidates: async (_q: string, items: unknown[], take: number) => ({
    items: items.slice(0, take),
    reranked: false,
  }),
}));
vi.mock("@/lib/platina/embed", () => ({ embedText: vi.fn() }));
vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));

const lessonsMock = listPlanLessons as unknown as Mock;
const insertMock = insertPlan as unknown as Mock;
const routeAIMock = routeAI as unknown as Mock;
const configMock = getWorkspaceConfig as unknown as Mock;
const vectorMock = similarBrainChunksQuery as unknown as Mock;
const lexicalMock = lexicalBrainChunksQuery as unknown as Mock;
const chunksMock = getBrainChunksByIds as unknown as Mock;
const provenanceMock = listSignalProvenance as unknown as Mock;
const brandMock = getBrand as unknown as Mock;
const competitorsMock = listCompetitorsOf as unknown as Mock;
const scopeSignalsMock = listSignalIdsForBrands as unknown as Mock;
const embedMock = embedText as unknown as Mock;

const PARAMS = {
  workspaceId: "ws_1",
  brief: "Launch our espresso subscription.\nTarget: home baristas.",
  userId: "user_1",
};

const PLAN = {
  title: "Espresso subscription launch",
  summary: "A short prep, then social to build the audience.",
  phases: [
    { name: "Prep", startDay: 1, endDay: 7, channel: "Email", message: "Warm the list." },
    { name: "Build audience", startDay: 8, endDay: 21, channel: "Social", message: "Post behind the scenes." },
  ],
};

const REVIEWER = "independent campaign reviewer";

function mockModel(opts: { plan?: unknown; review?: unknown; reviewThrows?: boolean } = {}) {
  routeAIMock.mockImplementation(async (task: { system?: string }) => {
    if (task.system?.includes(REVIEWER)) {
      if (opts.reviewThrows) throw new Error("provider down");
      return JSON.stringify(opts.review ?? { verdict: "pass", feedback: [] });
    }
    return JSON.stringify(opts.plan ?? PLAN);
  });
}

beforeEach(() => {
  lessonsMock.mockReset();
  insertMock.mockReset();
  routeAIMock.mockReset();
  lessonsMock.mockResolvedValue([]);
  insertMock.mockResolvedValue("plan_1");
  // Default: an empty Brain — no evidence, so plans are cold starts.
  configMock.mockReset().mockResolvedValue(null);
  vectorMock.mockReset().mockResolvedValue([]);
  lexicalMock.mockReset().mockResolvedValue([]);
  chunksMock.mockReset().mockResolvedValue([]);
  provenanceMock.mockReset().mockResolvedValue([]);
  embedMock.mockReset().mockResolvedValue(null);
  brandMock.mockReset().mockResolvedValue(null);
  competitorsMock.mockReset().mockResolvedValue([]);
  scopeSignalsMock.mockReset().mockResolvedValue([]);
});

describe("runPlanFlow (brief -> context -> planner -> validation -> review -> persist)", () => {
  it("cold start: plans from the brief, persists a workspace-scoped row", async () => {
    mockModel();

    const result = await runPlanFlow(PARAMS);

    expect(result).toMatchObject({
      status: "completed",
      output: { planId: "plan_1", criticFeedback: [] },
    });
    expect(lessonsMock).toHaveBeenCalledWith("ws_1", "worked", 3);
    expect(lessonsMock).toHaveBeenCalledWith("ws_1", "failed", 3);
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0][0];
    expect(row).toMatchObject({
      workspaceId: "ws_1",
      brief: PARAMS.brief,
      title: "Espresso subscription launch",
      lessonsUsed: 0,
      createdById: "user_1",
      critique: [],
    });
    expect(row.plan.phases.map((p: { id: string }) => p.id)).toEqual(["p1", "p2"]);
    expect(row.plan.totalDays).toBe(21);
  });

  it("the feedback loop: recorded results reach the planner and are counted on the plan", async () => {
    lessonsMock.mockImplementation(async (_ws: string, verdict: string) =>
      verdict === "worked"
        ? [{ title: "Spring email push", brief: "b", plan: { summary: "Drip.", totalDays: 7, phases: [{ channel: "Email" }] }, note: "Great opens" }]
        : [],
    );
    mockModel();

    await runPlanFlow(PARAMS);

    const plannerCall = routeAIMock.mock.calls
      .map(([t]) => t)
      .find((t) => !t.system?.includes(REVIEWER));
    expect(plannerCall.prompt).toContain("Spring email push");
    expect(plannerCall.prompt).toContain("Great opens");
    expect(insertMock.mock.calls[0][0].lessonsUsed).toBe(1);
  });

  it("persists the independent review's findings with the plan", async () => {
    mockModel({ review: { verdict: "flagged", feedback: ["Day 8-21 has no measurable goal."] } });

    const result = await runPlanFlow(PARAMS);

    expect(result).toMatchObject({
      status: "completed",
      output: { criticFeedback: ["Day 8-21 has no measurable goal."] },
    });
    expect(insertMock.mock.calls[0][0].critique).toEqual(["Day 8-21 has no measurable goal."]);
  });

  it("a failed review is recorded as feedback, never silently skipped", async () => {
    mockModel({ reviewThrows: true });

    const result = await runPlanFlow(PARAMS);

    expect(result).toMatchObject({
      status: "completed",
      output: { criticFeedback: [REVIEW_UNAVAILABLE_FEEDBACK] },
    });
  });

  it("an invalid plan is rejected before the review runs and nothing is saved", async () => {
    mockModel({
      plan: { ...PLAN, phases: [{ name: "Backwards", startDay: 9, endDay: 3, channel: "Email", message: "Send it." }] },
    });

    const result = await runPlanFlow(PARAMS);

    expect(result.status).toBe("invalid_proposal");
    expect(routeAIMock).toHaveBeenCalledTimes(1);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("a malformed planner response propagates and nothing is saved", async () => {
    routeAIMock.mockResolvedValue("not json");

    await expect(runPlanFlow(PARAMS)).rejects.toThrow();
    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe("runPlanFlow — grounded in collected evidence (core spine S6)", () => {
  function withBrain() {
    embedMock.mockResolvedValue([0.1, 0.2]);
    vectorMock.mockResolvedValue([{ id: "chunk_1", content: "Rivals push instant results.", score: 0.8 }]);
    lexicalMock.mockResolvedValue([]);
    chunksMock.mockResolvedValue([
      {
        id: "chunk_1",
        content: "Rivals push instant results.",
        confidence: 0.82,
        sourceSignalIds: ["sig_1"],
        createdAt: new Date("2026-09-10T00:00:00Z"),
      },
    ]);
    provenanceMock.mockResolvedValue([
      { id: "sig_1", sourceUrl: "https://rival.com/news", fetchedAt: new Date("2026-09-12T00:00:00Z") },
    ]);
  }

  it("persists the evidence snapshot with its source and collection date, and is not a cold start", async () => {
    withBrain();
    mockModel({
      plan: { ...PLAN, phases: [{ ...PLAN.phases[0], evidenceIds: ["chunk_1"] }, PLAN.phases[1]] },
    });

    const result = await runPlanFlow(PARAMS);

    expect(result.status).toBe("completed");
    const saved = insertMock.mock.calls[0][0].plan;
    expect(saved.coldStart).toBe(false);
    expect(saved.evidence).toEqual([
      expect.objectContaining({
        id: "chunk_1",
        plane: "B",
        sourceUrl: "https://rival.com/news",
        collectedAt: "2026-09-12T00:00:00.000Z",
      }),
    ]);
    expect(saved.phases[0].evidenceIds).toEqual(["chunk_1"]);
    // Every retrieval read is scoped to the calling workspace.
    expect(vectorMock.mock.calls[0][0]).toBe("ws_1");
    expect(chunksMock.mock.calls[0][0]).toBe("ws_1");
  });

  it("rejects, and saves nothing, when the planner cites evidence it was not shown", async () => {
    withBrain();
    mockModel({ plan: { ...PLAN, phases: [{ ...PLAN.phases[0], evidenceIds: ["invented"] }, PLAN.phases[1]] } });

    const result = await runPlanFlow(PARAMS);

    expect(result).toMatchObject({ status: "invalid_proposal" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("still plans, labelled cold-start, when nothing collected is relevant", async () => {
    embedMock.mockResolvedValue([0.1, 0.2]);
    vectorMock.mockResolvedValue([{ id: "chunk_9", content: "Unrelated.", score: 0.05 }]);
    mockModel();

    const result = await runPlanFlow(PARAMS);

    expect(result.status).toBe("completed");
    expect(insertMock.mock.calls[0][0].plan.coldStart).toBe(true);
    expect(insertMock.mock.calls[0][0].plan.evidence).toEqual([]);
  });

  it("falls back to lexical-only retrieval when embedding is unavailable", async () => {
    embedMock.mockResolvedValue(null);
    lexicalMock.mockResolvedValue([{ id: "chunk_1", content: "espresso", rank: 0.4 }]);
    chunksMock.mockResolvedValue([
      { id: "chunk_1", content: "Espresso demand is rising.", confidence: 0.7, sourceSignalIds: [], createdAt: new Date("2026-09-01T00:00:00Z") },
    ]);
    mockModel();

    await runPlanFlow(PARAMS);

    expect(vectorMock).not.toHaveBeenCalled();
    expect(insertMock.mock.calls[0][0].plan.evidence).toHaveLength(1);
    // No provenance row: the source is reported as unavailable, not invented.
    expect(insertMock.mock.calls[0][0].plan.evidence[0].sourceUrl).toBeNull();
  });
});

describe("runPlanFlow — real-time, use-case planning", () => {
  const CLIENT = { id: "brand_1", kind: "own_brand", name: "Northwind" };
  const chunk = (id: string, signalId: string, createdAt = "2026-09-10T00:00:00Z") => ({
    id,
    content: `Rival move ${id}`,
    confidence: 0.8,
    sourceSignalIds: [signalId],
    createdAt: new Date(createdAt),
  });

  function scopedBrain() {
    brandMock.mockResolvedValue(CLIENT);
    competitorsMock.mockResolvedValue([{ id: "rival_1" }]);
    scopeSignalsMock.mockResolvedValue(["sig_mine"]);
    embedMock.mockResolvedValue([0.1]);
    vectorMock.mockResolvedValue([
      { id: "c_mine", content: "x", score: 0.9 },
      { id: "c_other", content: "y", score: 0.85 },
    ]);
    chunksMock.mockResolvedValue([chunk("c_mine", "sig_mine"), chunk("c_other", "sig_other")]);
  }

  it("scopes evidence to the client and its competitors — another client's signal never reaches the planner", async () => {
    scopedBrain();
    mockModel();

    await runPlanFlow({ ...PARAMS, brandId: "brand_1", origin: { kind: "client", label: "Campaign for Northwind" } });

    const saved = insertMock.mock.calls[0][0];
    expect(saved.plan.evidence.map((e: { id: string }) => e.id)).toEqual(["c_mine"]);
    expect(scopeSignalsMock.mock.calls[0]).toEqual(["ws_1", ["brand_1", "rival_1"]]);
    expect(saved.brandId).toBe("brand_1");
    expect(saved.origin).toMatchObject({ kind: "client" });
    expect(saved.parentPlanId).toBeNull();
  });

  it("says a client with nothing collected has no evidence, rather than borrowing the workspace's", async () => {
    brandMock.mockResolvedValue(CLIENT);
    scopeSignalsMock.mockResolvedValue([]);
    embedMock.mockResolvedValue([0.1]);
    vectorMock.mockResolvedValue([{ id: "c_other", content: "y", score: 0.9 }]);
    mockModel();

    await runPlanFlow({ ...PARAMS, brandId: "brand_1" });

    const saved = insertMock.mock.calls[0][0].plan;
    expect(saved.evidenceStatus).toBe("no_client_evidence");
    expect(saved.coldStart).toBe(true);
    expect(vectorMock).not.toHaveBeenCalled();
  });

  it("distinguishes an empty knowledge base from one with nothing relevant", async () => {
    embedMock.mockResolvedValue([0.1]);
    mockModel();
    await runPlanFlow(PARAMS);
    expect(insertMock.mock.calls[0][0].plan.evidenceStatus).toBe("empty_brain");

    insertMock.mockClear();
    vectorMock.mockResolvedValue([{ id: "far", content: "z", score: 0.05 }]);
    await runPlanFlow(PARAMS);
    expect(insertMock.mock.calls[0][0].plan.evidenceStatus).toBe("none_relevant");
  });

  it("a revision links to its parent, gets the earlier plan in its prompt, and flags only newer evidence as NEW", async () => {
    embedMock.mockResolvedValue([0.1]);
    vectorMock.mockResolvedValue([
      { id: "c_new", content: "x", score: 0.9 },
      { id: "c_old", content: "y", score: 0.85 },
    ]);
    chunksMock.mockResolvedValue([
      chunk("c_new", "s1", "2026-09-15T00:00:00Z"),
      chunk("c_old", "s2", "2026-08-01T00:00:00Z"),
    ]);
    mockModel({
      plan: { ...PLAN, revisionNote: "Pulled the offer earlier.", phases: PLAN.phases.map((p) => ({ ...p, evidenceIds: [] })) },
    });

    const result = await runPlanFlow({
      ...PARAMS,
      revision: {
        planId: "parent_1",
        title: "Holiday push",
        summary: "Social then email.",
        phases: ["Days 1-14 · Social · Story"],
        createdAt: new Date("2026-09-01T00:00:00Z"),
      },
      origin: { kind: "revision", refId: "parent_1", label: "Revised: Holiday push" },
    });

    expect(result.status).toBe("completed");
    const prompt = routeAIMock.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('The earlier plan was "Holiday push"');
    expect(prompt).toContain("[c_new] NEW ");
    expect(prompt).not.toContain("[c_old] NEW ");
    const saved = insertMock.mock.calls[0][0];
    expect(saved.parentPlanId).toBe("parent_1");
    expect(saved.plan.revisionNote).toBe("Pulled the offer earlier.");
  });

  it("an event plan must cover its fixed date, or nothing is saved", async () => {
    mockModel(); // PLAN ends on day 21
    const miss = await runPlanFlow({ ...PARAMS, anchor: { label: "Roast Day", day: 30 } });
    expect(miss).toMatchObject({ status: "invalid_proposal" });
    expect(insertMock).not.toHaveBeenCalled();

    const hit = await runPlanFlow({ ...PARAMS, anchor: { label: "Roast Day", day: 15 } });
    expect(hit.status).toBe("completed");
  });
});
