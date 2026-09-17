import { describe, expect, it } from "vitest";
import { chunkProse, chunkRecord, PROSE_CHUNK_TARGET } from "./chunking";

describe("chunkRecord (R4.5)", () => {
  it("keeps one record atomic — never split mid-record", () => {
    const chunk = chunkRecord({
      label: "Q1 webinar campaign",
      fields: { leads: 42, qualifiedLeads: 17, conversionRate: 0.4048 },
    });
    expect(chunk).toContain("Q1 webinar campaign");
    expect(chunk).toContain("leads: 42");
    expect(chunk).toContain("conversionRate: 0.4048");
    // One record in, one chunk out — by construction.
    expect(typeof chunk).toBe("string");
  });

  it("omits empty fields", () => {
    const chunk = chunkRecord({
      label: "Record",
      fields: { a: "1", b: null, c: "", d: undefined },
    });
    expect(chunk).toContain("a: 1");
    expect(chunk).not.toContain("b:");
    expect(chunk).not.toContain("c:");
  });
});

describe("chunkProse", () => {
  it("returns empty for empty input", () => {
    expect(chunkProse("")).toEqual([]);
    expect(chunkProse("   \n\n  ")).toEqual([]);
  });

  it("keeps short prose as one chunk", () => {
    expect(chunkProse("Short declaration.")).toEqual(["Short declaration."]);
  });

  it("splits on paragraph boundaries, not mid-paragraph, when paragraphs fit", () => {
    const para = "x".repeat(590);
    const text = `${para}\n\n${para}\n\n${para}`;
    const chunks = chunkProse(text, PROSE_CHUNK_TARGET);
    // 590 + 2 (separator) + 590 = 1182 ≤ 1200 → two pack, third overflows.
    expect(chunks.length).toBe(2);
    // No paragraph was cut: every chunk is whole paragraphs.
    for (const chunk of chunks) {
      expect(chunk.split("\n\n").every((p) => p.length === 590)).toBe(true);
    }
  });

  it("splits an over-long paragraph on sentence boundaries", () => {
    const sentence = "This is a sentence about the brand standard. ";
    const paragraph = sentence.repeat(60); // ~2700 chars, one paragraph
    const chunks = chunkProse(paragraph, 800);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.endsWith(".") || chunk.length <= 800).toBe(true);
    }
  });

  it("hard-splits only as the last resort", () => {
    const blob = "x".repeat(5000); // no spaces, no sentences
    const chunks = chunkProse(blob, 800);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(blob);
  });
});
