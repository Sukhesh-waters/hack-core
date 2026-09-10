import { describe, expect, it } from "vitest";
import { chunk, stallCutoff } from "./batch";

describe("chunk", () => {
  it("splits into consecutive batches of at most `size`", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns one batch when the list fits", () => {
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });

  it("handles an empty list", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("rejects a non-positive size", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe("stallCutoff", () => {
  it("returns the timestamp N minutes before now", () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    expect(stallCutoff(now, 30)).toEqual(new Date("2026-07-20T11:30:00.000Z"));
  });

  it("crosses midnight correctly", () => {
    const now = new Date("2026-07-20T00:10:00.000Z");
    expect(stallCutoff(now, 30)).toEqual(new Date("2026-07-19T23:40:00.000Z"));
  });
});
