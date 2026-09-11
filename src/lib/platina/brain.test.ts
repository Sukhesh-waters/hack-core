import { describe, expect, it } from "vitest";
import {
  compactedRecord,
  compactionEligible,
  inheritedConfidence,
  mayRewriteGen0,
} from "./brain";

const chunk = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  generation: 0,
  confidence: 0.8,
  lastRetrievedAt: null,
  absorbedChunkIds: [],
  ...overrides,
});

describe("brain compaction", () => {
  it("inherits the parent MINIMUM confidence, never the average", () => {
    expect(
      inheritedConfidence([{ confidence: 0.9 }, { confidence: 0.4 }]),
    ).toBe(0.4);
  });

  it("blocks compaction when a gen-0 source contradicts another", () => {
    const result = compactionEligible([
      chunk("a"),
      chunk("b", { contradicts: true }),
      chunk("c"),
    ]);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("contradiction blocks compaction");
  });

  it("requires staleness and near-duplicate density", () => {
    const recent = compactionEligible(
      [chunk("a"), chunk("b"), chunk("c", { lastRetrievedAt: new Date() })],
      new Date(),
    );
    expect(recent.eligible).toBe(false);

    const stale = compactionEligible(
      [chunk("a"), chunk("b"), chunk("c")],
      new Date(),
    );
    expect(stale.eligible).toBe(true);
  });

  it("writes an additive gen-1 record and never rewrites gen-0", () => {
    expect(mayRewriteGen0()).toBe(false);
    const record = compactedRecord(
      [chunk("a", { confidence: 0.7 }), chunk("b", { confidence: 0.5 })],
      "compacted insight",
    );
    expect(record.generation).toBe(1);
    expect(record.absorbedChunkIds).toEqual(["a", "b"]);
    expect(record.confidence).toBe(0.5);
  });
});
