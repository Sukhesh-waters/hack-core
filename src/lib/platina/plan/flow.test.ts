import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { REVIEW_UNAVAILABLE_FEEDBACK, runPlanFlow } from "./flow";
import { insertPlan, listPlanLessons } from "@/db/queries/platina";
import { routeAI } from "@/lib/ai/router";

// Only the DB and the model router are mocked; the recipe, planner,
// validation, reviewer and orchestrator all run for real.
vi.mock("@/db/queries/platina", () => ({
  listPlanLessons: vi.fn(),
  insertPlan: vi.fn(),
}));
vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));

const lessonsMock = listPlanLessons as unknown as Mock;
const insertMock = insertPlan as unknown as Mock;
const routeAIMock = routeAI as unknown as Mock;

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
