import { describe, expect, it } from "vitest";
import { planBrandExtraction, hashBrandContent } from "./brand-sources";

const chunk = (text: string) => [text]; // single-chunk test double

describe("planBrandExtraction", () => {
  it("unchanged content produces no chunks", () => {
    const hash = hashBrandContent("the standard v1");
    const plan = planBrandExtraction("the standard v1", hash, chunk);
    expect(plan.changed).toBe(false);
    expect(plan.chunks).toEqual([]);
  });

  it("changed content produces chunks and a new hash", () => {
    const hash = hashBrandContent("the standard v1");
    const plan = planBrandExtraction("the standard v2", hash, chunk);
    expect(plan.changed).toBe(true);
    expect(plan.chunks).toEqual(["the standard v2"]);
    expect(plan.contentHash).not.toBe(hash);
  });

  it("the first extraction is always a change", () => {
    const plan = planBrandExtraction("anything", null, chunk);
    expect(plan.changed).toBe(true);
  });
});
