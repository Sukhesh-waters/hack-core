import { describe, expect, it } from "vitest";
import { chunksForScope } from "./scope";

const chunk = (id: string, signals: string[]) => ({
  id,
  content: `chunk ${id}`,
  sourceSignalIds: signals,
});

// One workspace, two clients. This is the shape of the bug R3 fixes.
const pool = [
  chunk("a1", ["sig_northwind_1"]),
  chunk("b1", ["sig_acme_1"]),
  chunk("a2", ["sig_bluebird_1"]), // Northwind's competitor
  chunk("b2", ["sig_acme_2", "sig_acme_3"]),
];

const northwind = new Set(["sig_northwind_1", "sig_bluebird_1"]);
const acme = new Set(["sig_acme_1", "sig_acme_2", "sig_acme_3"]);

describe("chunksForScope", () => {
  it("returns only the chunks resting on this client's signals", () => {
    expect(chunksForScope(pool, northwind, 10).map((c) => c.id)).toEqual(["a1", "a2"]);
  });

  it("never leaks another client's evidence into this client's stage", () => {
    const ids = chunksForScope(pool, northwind, 10).map((c) => c.id);
    expect(ids).not.toContain("b1");
    expect(ids).not.toContain("b2");
  });

  it("includes a competitor's evidence — that is the point of the comparison", () => {
    expect(chunksForScope(pool, northwind, 10).map((c) => c.id)).toContain("a2");
  });

  it("matches a chunk that rests on several signals if any one is in scope", () => {
    expect(chunksForScope(pool, new Set(["sig_acme_3"]), 10).map((c) => c.id)).toEqual([
      "b2",
    ]);
  });

  it("returns NOTHING for an empty scope — it never widens to the workspace", () => {
    expect(chunksForScope(pool, new Set(), 10)).toEqual([]);
  });

  it("keeps the pool's order and respects the limit", () => {
    expect(chunksForScope(pool, acme, 1).map((c) => c.id)).toEqual(["b1"]);
  });

  it("handles a chunk with no source signals without throwing", () => {
    expect(chunksForScope([chunk("orphan", [])], northwind, 10)).toEqual([]);
  });
});
