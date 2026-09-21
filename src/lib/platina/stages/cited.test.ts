import { describe, expect, it } from "vitest";
import { fitWords, parseCited } from "./cited";

const rule = { brand: new Set<string>(), brain: new Set(["b1"]), require: { brand: false, brain: true } };

describe("parseCited — a long title is trimmed, never the whole reply lost", () => {
  it("keeps a direction whose title and summary run long (live Waters runs lost all 3)", () => {
    const title = "Position Waters as the GLP-1 analytical partner across discovery, QC and release testing in the GCC";
    const reply = JSON.stringify({
      items: [{ title, summary: "s ".repeat(300), severity: "low", brainChunkIds: ["b1"] }],
    });
    const { items, rejected } = parseCited(reply, rule);
    expect(rejected).toBe(0);
    expect(items).toHaveLength(1);
    expect(items[0].title.length).toBeLessThanOrEqual(80);
    expect(items[0].title.endsWith("…")).toBe(true);
    expect(items[0].summary.length).toBeLessThanOrEqual(400);
  });

  it("still rejects a title too short to mean anything (that item only)", () => {
    expect(
      parseCited(JSON.stringify({ items: [{ title: "x", summary: "long enough summary", brainChunkIds: ["b1"] }] }), rule),
    ).toEqual({ items: [], rejected: 1 });
  });
});

describe("fitWords", () => {
  it("cuts at a word boundary and marks the cut", () => {
    expect(fitWords("short", 80)).toBe("short");
    expect(fitWords("alpha beta gamma delta", 12)).toBe("alpha beta…");
  });
});

describe("parseCited — derailed replies (live 2026-09-21)", () => {
  const rule = { brand: new Set<string>(), brain: new Set(["b1"]), require: { brand: false, brain: true } };
  const good = { title: "Agilent launches GC", summary: "Agilent launched a faster GC system for labs.", brainChunkIds: ["b1"] };

  it('reads "items": null as nothing to propose, not as a broken reply', () => {
    expect(parseCited(JSON.stringify({ items: null }), rule)).toEqual({ items: [], rejected: 0 });
  });

  it("keeps the good items when one sibling is malformed", () => {
    const result = parseCited(JSON.stringify({ items: [good, { title: "x" }] }), rule);
    expect(result.items).toHaveLength(1);
    expect(result.rejected).toBe(1);
  });

  it("keeps the first five instead of rejecting a longer list", () => {
    expect(parseCited(JSON.stringify({ items: Array(7).fill(good) }), rule).items).toHaveLength(5);
  });

  it("still throws when there is no JSON envelope at all", () => {
    expect(() => parseCited("Sorry, I cannot help.", rule)).toThrow(/not the expected JSON/);
  });
});
