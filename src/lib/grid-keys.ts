/**
 * U6 — pure keyboard/selection math for the plan grid.
 *
 * Deliberately dependency-free: no React, no DOM. The grid wires these into
 * onKeyDown handlers, but the coordinate arithmetic (where does the cursor
 * go, which rows does a fill-down touch) is fully testable without mounting
 * a component or faking a keyboard event.
 */

export type GridCoord = { row: number; col: number };

export type GridSize = { rowCount: number; colCount: number };

export type NavKey =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "Tab"
  | "ShiftTab"
  | "Home"
  | "End";

/**
 * Computes the next cell coordinate for a navigation key, clamped to the
 * grid bounds. Nothing here ever produces a coordinate outside
 * [0, rowCount) x [0, colCount) — callers can trust the result is always a
 * real cell (or the same cell, if the move was already at an edge).
 *
 * Tab / Shift+Tab wrap to the next/previous row's first/last column, mirroring
 * spreadsheet tab order (left-to-right, top-to-bottom) rather than the
 * browser's native DOM tab order.
 */
export function nextCoord(
  current: GridCoord,
  key: NavKey,
  size: GridSize,
): GridCoord {
  const { rowCount, colCount } = size;
  const lastRow = Math.max(rowCount - 1, 0);
  const lastCol = Math.max(colCount - 1, 0);
  const clampRow = (r: number) => Math.min(Math.max(r, 0), lastRow);
  const clampCol = (c: number) => Math.min(Math.max(c, 0), lastCol);

  switch (key) {
    case "ArrowUp":
      return { row: clampRow(current.row - 1), col: current.col };
    case "ArrowDown":
      return { row: clampRow(current.row + 1), col: current.col };
    case "ArrowLeft":
      return { row: current.row, col: clampCol(current.col - 1) };
    case "ArrowRight":
      return { row: current.row, col: clampCol(current.col + 1) };
    case "Home":
      return { row: current.row, col: 0 };
    case "End":
      return { row: current.row, col: lastCol };
    case "Tab": {
      if (current.col >= lastCol) {
        // At the very last cell of the grid there is nowhere to wrap to —
        // stay put rather than resetting to column 0 on the same last row.
        if (current.row >= lastRow) return current;
        return { row: current.row + 1, col: 0 };
      }
      return { row: current.row, col: current.col + 1 };
    }
    case "ShiftTab": {
      if (current.col <= 0) {
        if (current.row <= 0) return current;
        return { row: current.row - 1, col: lastCol };
      }
      return { row: current.row, col: current.col - 1 };
    }
  }
}

/**
 * Maps a raw keyboard event's key + modifier state to a NavKey, or null if
 * the key isn't one this grid handles (e.g. a letter being typed into an
 * input). Kept here — not in the component — so the "what counts as
 * navigation" decision is covered by the same tests as the coordinate math.
 */
export function resolveNavKey(
  key: string,
  modifiers: { shift?: boolean } = {},
): NavKey | null {
  switch (key) {
    case "ArrowUp":
    case "ArrowDown":
    case "ArrowLeft":
    case "ArrowRight":
    case "Home":
    case "End":
      return key;
    case "Tab":
      return modifiers.shift ? "ShiftTab" : "Tab";
    default:
      return null;
  }
}

/**
 * Which row indices a "fill down" should write to, given an anchor row and
 * the set of currently-selected row indices.
 *
 * The anchor's own value is the source, so the anchor row itself is never a
 * target — filling down copies the anchor INTO the rest of the selection,
 * it never rewrites the row the value came from. Only selected rows below
 * (or above) are eligible; an unselected row in the middle of a selection is
 * impossible by construction since selection is a set, not a range, but this
 * stays a plain filter over the selection rather than assuming
 * contiguity — a future non-contiguous multi-select still fills correctly.
 */
export function fillDownTargets(
  anchorRow: number,
  selectedRows: readonly number[],
): number[] {
  return selectedRows
    .filter((row) => row !== anchorRow)
    .sort((a, b) => a - b);
}

/**
 * Expands a shift-click range on row checkboxes: every row index between the
 * last-clicked row and the newly-clicked row, inclusive, regardless of which
 * one is numerically first (shift-clicking upward must work the same as
 * shift-clicking downward).
 */
export function expandRowRange(fromRow: number, toRow: number): number[] {
  const start = Math.min(fromRow, toRow);
  const end = Math.max(fromRow, toRow);
  const range: number[] = [];
  for (let r = start; r <= end; r += 1) range.push(r);
  return range;
}
