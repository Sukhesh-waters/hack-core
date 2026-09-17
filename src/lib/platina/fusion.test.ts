import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "./fusion";

describe("reciprocalRankFusion (R4.4)", () => {
  it("an item atop both lists wins", () => {
    const fused = reciprocalRankFusion([
      { items: [{ id: "a" }, { id: "b" }] },
      { items: [{ id: "a" }, { id: "c" }] },
    ]);
    expect(fused[0].item.id).toBe("a");
  });

  it("a lexical-only exact hit outranks a weak vector tail", () => {
    const vector = Array.from({ length: 20 }, (_, i) => ({ id: `v${i}` }));
    const fused = reciprocalRankFusion([
      { items: vector },
      { items: [{ id: "exact-match" }] },
    ]);
    // The exact hit (rank 1 of the lexical list) must outrank vector rank 20.
    const exactScore = fused.find((f) => f.item.id === "exact-match")!.score;
    const tailScore = fused.find((f) => f.item.id === "v19")!.score;
    expect(exactScore).toBeGreaterThan(tailScore);
  });

  it("handles disjoint lists and empty inputs", () => {
    const fused = reciprocalRankFusion([
      { items: [{ id: "a" }] },
      { items: [] },
      { items: [{ id: "b" }] },
    ]);
    expect(fused.map((f) => f.item.id).sort()).toEqual(["a", "b"]);
    expect(reciprocalRankFusion([])).toEqual([]);
  });

  it("is deterministic for ties", () => {
    const a = reciprocalRankFusion([{ items: [{ id: "x" }, { id: "y" }] }]);
    const b = reciprocalRankFusion([{ items: [{ id: "x" }, { id: "y" }] }]);
    expect(a.map((f) => f.item.id)).toEqual(b.map((f) => f.item.id));
  });
});
