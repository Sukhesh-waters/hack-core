import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("@/lib/ai/router", () => ({
  routeAI: vi.fn(),
}));

import { routeAI } from "@/lib/ai/router";
import { rerankCandidates } from "./rerank";

const candidates = [
  { id: "a", content: "alpha" },
  { id: "b", content: "beta" },
  { id: "c", content: "gamma" },
];

afterEach(() => {
  vi.mocked(routeAI).mockReset();
});

describe("rerankCandidates (R4.3)", () => {
  it("orders by the model's relevance scores", async () => {
    vi.mocked(routeAI).mockResolvedValue('{"scores":[0.1,0.9,0.5]}' as never);
    const result = await rerankCandidates("topic", candidates, 3);
    expect(result.reranked).toBe(true);
    expect(result.items.map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("takes only the requested count", async () => {
    vi.mocked(routeAI).mockResolvedValue('{"scores":[0.9,0.8,0.7]}' as never);
    const result = await rerankCandidates("topic", candidates, 2);
    expect(result.items).toHaveLength(2);
  });

  it("falls back to the fused order on router failure — never a fake score", async () => {
    vi.mocked(routeAI).mockRejectedValue(new Error("router down"));
    const result = await rerankCandidates("topic", candidates, 3);
    expect(result.reranked).toBe(false);
    expect(result.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("falls back when the model returns a malformed score list", async () => {
    vi.mocked(routeAI).mockResolvedValue('{"scores":[0.9]}' as never);
    const result = await rerankCandidates("topic", candidates, 3);
    expect(result.reranked).toBe(false);
    expect(result.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("skips the model call for a single candidate", async () => {
    const result = await rerankCandidates("topic", [candidates[0]], 1);
    expect(result.reranked).toBe(false);
    expect(routeAI).not.toHaveBeenCalled();
  });
});
