import { describe, expect, it } from "vitest";
import {
  expandRowRange,
  fillDownTargets,
  nextCoord,
  resolveNavKey,
  type GridSize,
} from "./grid-keys";

const size: GridSize = { rowCount: 5, colCount: 4 };

describe("nextCoord — arrow keys", () => {
  it("ArrowDown moves down one row, same column", () => {
    expect(nextCoord({ row: 1, col: 2 }, "ArrowDown", size)).toEqual({
      row: 2,
      col: 2,
    });
  });

  it("ArrowUp moves up one row, same column", () => {
    expect(nextCoord({ row: 3, col: 2 }, "ArrowUp", size)).toEqual({
      row: 2,
      col: 2,
    });
  });

  it("ArrowUp clamps at row 0 — never moves above the top row", () => {
    expect(nextCoord({ row: 0, col: 2 }, "ArrowUp", size)).toEqual({
      row: 0,
      col: 2,
    });
  });

  it("ArrowDown clamps at the last row", () => {
    expect(nextCoord({ row: 4, col: 2 }, "ArrowDown", size)).toEqual({
      row: 4,
      col: 2,
    });
  });

  it("ArrowRight moves right one column", () => {
    expect(nextCoord({ row: 1, col: 1 }, "ArrowRight", size)).toEqual({
      row: 1,
      col: 2,
    });
  });

  it("ArrowRight clamps at the last column — never overflows past it", () => {
    expect(nextCoord({ row: 1, col: 3 }, "ArrowRight", size)).toEqual({
      row: 1,
      col: 3,
    });
  });

  it("ArrowLeft moves left one column", () => {
    expect(nextCoord({ row: 1, col: 1 }, "ArrowLeft", size)).toEqual({
      row: 1,
      col: 0,
    });
  });

  it("ArrowLeft clamps at column 0", () => {
    expect(nextCoord({ row: 1, col: 0 }, "ArrowLeft", size)).toEqual({
      row: 1,
      col: 0,
    });
  });
});

describe("nextCoord — Home/End", () => {
  it("Home goes to column 0 of the same row", () => {
    expect(nextCoord({ row: 2, col: 3 }, "Home", size)).toEqual({
      row: 2,
      col: 0,
    });
  });

  it("End goes to the last column of the same row", () => {
    expect(nextCoord({ row: 2, col: 0 }, "End", size)).toEqual({
      row: 2,
      col: 3,
    });
  });
});

describe("nextCoord — Tab / Shift+Tab wrapping", () => {
  it("Tab moves to the next column mid-row", () => {
    expect(nextCoord({ row: 1, col: 1 }, "Tab", size)).toEqual({
      row: 1,
      col: 2,
    });
  });

  it("Tab at the last column wraps to the first column of the next row", () => {
    expect(nextCoord({ row: 1, col: 3 }, "Tab", size)).toEqual({
      row: 2,
      col: 0,
    });
  });

  it("Tab at the last cell of the last row stays put (no overflow)", () => {
    expect(nextCoord({ row: 4, col: 3 }, "Tab", size)).toEqual({
      row: 4,
      col: 3,
    });
  });

  it("Shift+Tab moves to the previous column mid-row", () => {
    expect(nextCoord({ row: 1, col: 2 }, "ShiftTab", size)).toEqual({
      row: 1,
      col: 1,
    });
  });

  it("Shift+Tab at the first column wraps to the last column of the previous row", () => {
    expect(nextCoord({ row: 1, col: 0 }, "ShiftTab", size)).toEqual({
      row: 0,
      col: 3,
    });
  });

  it("Shift+Tab at the first cell of the first row stays put", () => {
    expect(nextCoord({ row: 0, col: 0 }, "ShiftTab", size)).toEqual({
      row: 0,
      col: 0,
    });
  });
});

describe("nextCoord — degenerate grid sizes", () => {
  it("a 0-row grid clamps everything to row 0", () => {
    const empty: GridSize = { rowCount: 0, colCount: 4 };
    expect(nextCoord({ row: 0, col: 0 }, "ArrowDown", empty)).toEqual({
      row: 0,
      col: 0,
    });
  });

  it("a single-column grid never moves horizontally", () => {
    const oneCol: GridSize = { rowCount: 3, colCount: 1 };
    expect(nextCoord({ row: 1, col: 0 }, "ArrowRight", oneCol)).toEqual({
      row: 1,
      col: 0,
    });
  });
});

describe("resolveNavKey", () => {
  it("maps arrow keys and Home/End straight through", () => {
    expect(resolveNavKey("ArrowUp")).toBe("ArrowUp");
    expect(resolveNavKey("ArrowDown")).toBe("ArrowDown");
    expect(resolveNavKey("ArrowLeft")).toBe("ArrowLeft");
    expect(resolveNavKey("ArrowRight")).toBe("ArrowRight");
    expect(resolveNavKey("Home")).toBe("Home");
    expect(resolveNavKey("End")).toBe("End");
  });

  it("maps plain Tab to Tab", () => {
    expect(resolveNavKey("Tab")).toBe("Tab");
  });

  it("maps Shift+Tab to ShiftTab", () => {
    expect(resolveNavKey("Tab", { shift: true })).toBe("ShiftTab");
  });

  it("returns null for keys the grid doesn't navigate on", () => {
    expect(resolveNavKey("a")).toBeNull();
    expect(resolveNavKey("Enter")).toBeNull();
    expect(resolveNavKey("Escape")).toBeNull();
  });
});

describe("fillDownTargets", () => {
  it("targets every selected row except the anchor", () => {
    expect(fillDownTargets(2, [2, 3, 4, 5])).toEqual([3, 4, 5]);
  });

  it("returns targets sorted ascending regardless of selection order", () => {
    expect(fillDownTargets(0, [5, 1, 3])).toEqual([1, 3, 5]);
  });

  it("the anchor is never a target even if listed twice in the selection", () => {
    expect(fillDownTargets(1, [1, 1, 2])).toEqual([2]);
  });

  it("an anchor outside the selection changes nothing", () => {
    expect(fillDownTargets(9, [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("a selection with only the anchor fills nothing", () => {
    expect(fillDownTargets(4, [4])).toEqual([]);
  });

  it("an empty selection fills nothing", () => {
    expect(fillDownTargets(0, [])).toEqual([]);
  });
});

describe("expandRowRange", () => {
  it("expands a forward range inclusive of both ends", () => {
    expect(expandRowRange(2, 5)).toEqual([2, 3, 4, 5]);
  });

  it("expands a backward shift-click the same as forward", () => {
    expect(expandRowRange(5, 2)).toEqual([2, 3, 4, 5]);
  });

  it("a single-row range returns just that row", () => {
    expect(expandRowRange(3, 3)).toEqual([3]);
  });
});
