import { describe, expect, it, vi, type Mock } from "vitest";
import { similarFirstPartyChunksQuery } from "@/db/queries/platina-learning";
import { retrieveBaselineEvidence } from "./context";

vi.mock("@/db/queries/platina", () => ({}));
vi.mock("@/db/queries/platina-learning", () => ({
  similarFirstPartyChunksQuery: vi.fn(),
  listConfirmedResults: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/platina/embed", () => ({ embedText: vi.fn() }));
vi.mock("@/lib/platina/rerank", () => ({ rerankCandidates: vi.fn() }));
vi.mock("@/lib/ai/router", () => ({ routeAI: vi.fn() }));

const queryMock = similarFirstPartyChunksQuery as unknown as Mock;
const at = new Date("2026-09-20T00:00:00Z");

describe("retrieveBaselineEvidence (C6: the client's own site and lessons reach the planner)", () => {
  it("returns Plane A evidence above the floor, scoped to the client, lessons labelled", async () => {
    queryMock.mockResolvedValue([
      { id: "fp1", kind: "own_site", content: "Xevo TQ Absolute for PFAS", sourceUrl: "https://waters.com/xevo", title: "Xevo", createdAt: at, score: 0.71 },
      { id: "fp2", kind: "lesson", content: "Carousel on GLP-1 beat the usual post", sourceUrl: null, title: "GLP-1", createdAt: at, score: 0.52 },
      { id: "fp3", kind: "own_site", content: "Careers at Waters", sourceUrl: "https://waters.com/careers", title: "Careers", createdAt: at, score: 0.2 },
    ]);
    const out = await retrieveBaselineEvidence({ workspaceId: "ws", brandId: "b1", embedding: [0.1], floor: 0.35, newSince: null });
    expect(queryMock).toHaveBeenCalledWith("ws", [0.1], { brandId: "b1", limit: 12 });
    expect(out.map((e) => e.id)).toEqual(["fp1", "fp2"]);
    expect(out.every((e) => e.plane === "A")).toBe(true);
    expect(out[1].content).toMatch(/^Lesson from our own results: /);
  });

  it("an embedding outage returns nothing rather than guessing", async () => {
    queryMock.mockClear();
    expect(await retrieveBaselineEvidence({ workspaceId: "ws", brandId: null, embedding: null, floor: 0.35, newSince: null })).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
