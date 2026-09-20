import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { assembleIdeationContext, DECLARED_ONLY_BRIEF } from "./ideation";
import { NO_BRAND_CONTEXT_ERROR } from "@/lib/ai/brand-merge";
import { getBrandProfile } from "@/db/queries/brand";
import { getClientGoalById } from "@/db/queries/client-goals";
import { retrieveDrivers } from "@/lib/ai/retrieval";

vi.mock("@/db/queries/brand", () => ({ getBrandProfile: vi.fn() }));
vi.mock("@/db/queries/client-goals", () => ({ getClientGoalById: vi.fn() }));
vi.mock("@/lib/ai/retrieval", () => ({ retrieveDrivers: vi.fn() }));

const profileMock = getBrandProfile as unknown as Mock;
const goalMock = getClientGoalById as unknown as Mock;
const retrieveMock = retrieveDrivers as unknown as Mock;

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

const PARAMS = { workspaceId: "ws_1", clientId: "c_1", topic: "summer launch" };

beforeEach(() => {
  profileMock.mockReset();
  goalMock.mockReset();
  retrieveMock.mockReset();
});

describe("assembleIdeationContext", () => {
  it("reports missing_context when no brand profile exists — before any retrieval", async () => {
    profileMock.mockResolvedValue(null);

    const result = await assembleIdeationContext(PARAMS);

    expect(result).toEqual({
      state: "missing_context",
      reason: NO_BRAND_CONTEXT_ERROR,
    });
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it("assembles first-party evidence when the baseline gate passes", async () => {
    profileMock.mockResolvedValue({ declared: null, identity: IDENTITY });
    retrieveMock.mockResolvedValue({
      status: "ready",
      brief: "Reels win [aaaabbbb].",
      citedPostIds: ["post_1"],
      drivers: [{ id: "post_1", caption: "c", direction: "up", magnitude: 1, format: "reel" }],
    });

    const result = await assembleIdeationContext(PARAMS);

    expect(result.state).toBe("context_available");
    if (result.state !== "context_available") return;
    expect(result.context.evidence).toMatchObject({
      mode: "first_party",
      citedPostIds: ["post_1"],
    });
    expect(result.context.topic).toBe("summer launch");
    expect(result.context.goal).toBeNull();
    expect(retrieveMock).toHaveBeenCalledWith(PARAMS);
  });

  it("below the min-N gate with no declared context: insufficient_baseline, nothing invented", async () => {
    profileMock.mockResolvedValue({ declared: null, identity: IDENTITY });
    retrieveMock.mockResolvedValue({
      status: "insufficient_baseline",
      sampleSize: 4,
    });

    const result = await assembleIdeationContext(PARAMS);

    expect(result).toEqual({ state: "insufficient_baseline", sampleSize: 4 });
  });

  it("below the min-N gate WITH declared context: degrades to declared-only", async () => {
    profileMock.mockResolvedValue({ declared: DECLARED, identity: IDENTITY });
    retrieveMock.mockResolvedValue({
      status: "insufficient_baseline",
      sampleSize: 4,
    });

    const result = await assembleIdeationContext(PARAMS);

    expect(result.state).toBe("context_available");
    if (result.state !== "context_available") return;
    expect(result.context.evidence).toEqual({
      mode: "declared_only",
      brief: DECLARED_ONLY_BRIEF,
    });
  });

  it("resolves the goal only through the workspace+client-scoped lookup", async () => {
    profileMock.mockResolvedValue({ declared: DECLARED, identity: IDENTITY });
    retrieveMock.mockResolvedValue({ status: "insufficient_baseline", sampleSize: 0 });
    goalMock.mockResolvedValue({ title: "Grow saves", hypothesis: "Educational hooks win" });

    const result = await assembleIdeationContext({ ...PARAMS, goalId: "goal_1" });

    expect(goalMock).toHaveBeenCalledWith("ws_1", "c_1", "goal_1");
    if (result.state !== "context_available") throw new Error("expected context");
    expect(result.context.goal).toEqual({
      title: "Grow saves",
      hypothesis: "Educational hooks win",
    });
  });

  it("a forged goalId that resolves to nothing yields no goal, not an error", async () => {
    profileMock.mockResolvedValue({ declared: DECLARED, identity: IDENTITY });
    retrieveMock.mockResolvedValue({ status: "insufficient_baseline", sampleSize: 0 });
    goalMock.mockResolvedValue(null);

    const result = await assembleIdeationContext({ ...PARAMS, goalId: "forged" });

    if (result.state !== "context_available") throw new Error("expected context");
    expect(result.context.goal).toBeNull();
  });
});
