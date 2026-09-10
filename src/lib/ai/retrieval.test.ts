import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { buildBriefPrompt, retrieveDrivers, type DriverPost } from "./retrieval";
import { MIN_BASELINE_N } from "@/lib/scoring";
import { routeAI } from "@/lib/ai/router";
import {
  getBaselinePoints,
  similarPostsQuery,
  topMoversQuery,
} from "@/db/queries/posts";

vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));
vi.mock("@/db/queries/posts", () => ({
  getBaselinePoints: vi.fn(),
  similarPostsQuery: vi.fn(),
  topMoversQuery: vi.fn(),
}));

const routeAIMock = routeAI as unknown as Mock;
const baselineMock = getBaselinePoints as unknown as Mock;
const similarMock = similarPostsQuery as unknown as Mock;
const moversMock = topMoversQuery as unknown as Mock;

const point = { value: 0.1, postedAt: new Date("2026-06-01") };

function driver(id: string, overrides: Partial<DriverPost> = {}): DriverPost {
  return {
    id,
    caption: `caption for ${id}`,
    direction: "up",
    magnitude: 0.8,
    format: "reel",
    ...overrides,
  };
}

beforeEach(() => {
  routeAIMock.mockReset();
  baselineMock.mockReset();
  similarMock.mockReset();
  moversMock.mockReset();
});

describe("buildBriefPrompt", () => {
  it("renders drivers with 8-char citation ids and the topic", () => {
    const prompt = buildBriefPrompt("summer launch", [
      driver("aaaabbbb-1111-2222-3333-444455556666"),
    ]);
    expect(prompt).toContain("summer launch");
    expect(prompt).toContain("[aaaabbbb]");
    expect(prompt).toContain("direction=up");
  });
});

describe("retrieveDrivers", () => {
  it("min-N gate: refuses to build a brief below the baseline threshold", async () => {
    baselineMock.mockResolvedValue(
      Array(MIN_BASELINE_N - 1).fill(point),
    );
    const result = await retrieveDrivers({
      workspaceId: "ws_1",
      clientId: "c_1",
      topic: "anything",
    });
    expect(result).toEqual({
      status: "insufficient_baseline",
      sampleSize: MIN_BASELINE_N - 1,
    });
    expect(routeAIMock).not.toHaveBeenCalled();
  });

  it("builds a brief from first-party drivers and maps citations back to full ids", async () => {
    baselineMock.mockResolvedValue(Array(MIN_BASELINE_N + 5).fill(point));
    const up = driver("aaaabbbb-0000-0000-0000-000000000000");
    const down = driver("ccccdddd-0000-0000-0000-000000000000", {
      direction: "down",
    });
    routeAIMock.mockImplementation((task: { kind: string }) => {
      if (task.kind === "embed") return Promise.resolve([[0.1, 0.2]]);
      return Promise.resolve(
        "Lean into launches [aaaabbbb]; avoid flat updates [ccccdddd].",
      );
    });
    similarMock.mockReturnValue(Promise.resolve([up]));
    moversMock.mockImplementation(
      (_ws: string, _c: string, direction: string) =>
        Promise.resolve(direction === "up" ? [up] : [down]),
    );

    const result = await retrieveDrivers({
      workspaceId: "ws_1",
      clientId: "c_1",
      topic: "summer launch",
    });
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.citedPostIds).toEqual([
        "aaaabbbb-0000-0000-0000-000000000000",
        "ccccdddd-0000-0000-0000-000000000000",
      ]);
      // deduped: the up-mover appears in similar AND movers but once here
      expect(result.drivers.filter((d) => d.id === up.id)).toHaveLength(1);
    }
  });

  it("still builds a brief when embeddings are missing (similarity empty)", async () => {
    baselineMock.mockResolvedValue(Array(MIN_BASELINE_N).fill(point));
    routeAIMock.mockImplementation((task: { kind: string }) =>
      task.kind === "embed"
        ? Promise.resolve([[0.1]])
        : Promise.resolve("Brief without similarity."),
    );
    similarMock.mockReturnValue(Promise.resolve([]));
    moversMock.mockReturnValue(Promise.resolve([driver("eeeeffff-0-0-0-0")]));

    const result = await retrieveDrivers({
      workspaceId: "ws_1",
      clientId: "c_1",
      topic: "t",
    });
    expect(result.status).toBe("ready");
  });
});
