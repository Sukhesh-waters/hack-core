"use client";

import { Fragment, useContext, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CONTENT_TYPE_COLORS, type ContentType } from "@/lib/colors";
import { isVideoContentType } from "@/db/schema";
import type { PlanCellField } from "@/lib/plan-cell";
import type { CustomFieldDefinition } from "@/lib/custom-fields";
import Link from "next/link";
import {
  groupRows,
  toggleSort,
  visibleCustomFieldColumns,
  type PlanGrouping,
  type PlanScope,
  type PlanSortColumn,
  type ResolvedPlanSort,
} from "@/lib/plan-view";
import { buildHref } from "./view-controls";
import {
  expandRowRange,
  fillDownTargets,
  nextCoord,
  resolveNavKey,
} from "@/lib/grid-keys";
import {
  askPlanRowAction,
  bulkUpdatePlanCellsAction,
  updatePlanCellAction,
} from "./actions";
import { saveCustomFieldValueAction } from "./custom-field-actions";
import { RevisionDrawer, type RevisionView } from "./revision-drawer";
import { CustomFieldsContext, DetailPanel } from "./detail-panel";
import { CustomFieldInput } from "@/components/custom-field-input";

export type PlanRowView = {
  id: string;
  scheduledForIso: string | null;
  clientName: string;
  type: ContentType;
  durationSec: number | null;
  pillar: string | null;
  strategyNote: string | null;
  title: string;
  status: string;
  complianceStatus: string;
  productionStage: string | null;
  assigneeId: string | null;
  dueAtIso: string | null;
  revisionCount: number;
  /** Unapplied proposals waiting on a human (S3). */
  pendingSuggestions: number;
};

export type MemberOption = { id: string; label: string };

/**
 * Rows past this render behind a "show all" toggle rather than a windowing
 * library. At small-agency scale a month is tens of rows; the cap exists so
 * a mis-set range can't paint 500 rows of live inputs.
 */
const VISIBLE_CAP = 100;

const CONTENT_TYPES: ContentType[] = [
  "post",
  "reel",
  "story",
  "carousel",
  "talking_head",
  "motion_graphic",
  "static",
];

const cellClass =
  "w-full rounded-sm border border-transparent bg-transparent px-1.5 py-1 text-sm text-foreground outline-none hover:border-border focus:border-brand-teal/60 focus:bg-muted";

/**
 * U6 — the editable columns in keyboard-navigation order, left to right.
 * Deliberately excludes status/complianceStatus/productionStage: those
 * render as read-only badges with no input to focus, so they are simply
 * absent from the coordinate space arrow keys move through. This same list
 * backs the "fill down" control — its `getValue` is what gets copied from
 * the anchor row into the rest of the selection.
 */
const EDITABLE_COLUMNS: {
  field: PlanCellField;
  label: string;
  getValue: (row: PlanRowView) => string | number | null;
}[] = [
  { field: "scheduledFor", label: "Date", getValue: (r) => r.scheduledForIso },
  { field: "type", label: "Type", getValue: (r) => r.type },
  { field: "durationSec", label: "Duration", getValue: (r) => r.durationSec },
  { field: "pillar", label: "Pillar", getValue: (r) => r.pillar },
  { field: "strategyNote", label: "Strategy", getValue: (r) => r.strategyNote },
  { field: "title", label: "Title", getValue: (r) => r.title },
  { field: "assigneeId", label: "Assignee", getValue: (r) => r.assigneeId },
  { field: "dueAt", label: "Due", getValue: (r) => r.dueAtIso },
];

/** The columns the U5 bulk-edit bar offers — a narrower set than the full
 *  editable-column list, matching the brief exactly (pillar, assignee, due
 *  date, type). Fill-down is not limited to these four; the bulk-edit BAR
 *  is, because setting an entire selection's title or strategy note to one
 *  identical string is not a real workflow the way setting them all to the
 *  same pillar or owner is. */
type BulkField = "pillar" | "assigneeId" | "dueAt" | "type";
const BULK_FIELDS: { field: BulkField; label: string }[] = [
  { field: "pillar", label: "Pillar" },
  { field: "assigneeId", label: "Assignee" },
  { field: "dueAt", label: "Due date" },
  { field: "type", label: "Type" },
];

/** Converts an EDITABLE_COLUMNS/BULK_FIELDS value back into the
 *  PlanRowView patch shape, mirroring commit()'s per-field patches exactly
 *  so optimistic bulk/fill-down updates never drift from what a single-cell
 *  edit would paint. Type changes clear duration when leaving video, same
 *  as the single-cell path — computed per row since each row's current
 *  duration differs. */
function patchForField(
  field: PlanCellField,
  value: string | number | null,
  row: PlanRowView,
): Partial<PlanRowView> {
  switch (field) {
    case "scheduledFor":
      return { scheduledForIso: value === null ? null : String(value) };
    case "type": {
      const next = value as ContentType;
      return {
        type: next,
        durationSec: isVideoContentType(next) ? row.durationSec : null,
      };
    }
    case "durationSec":
      return { durationSec: value === null ? null : Number(value) };
    case "pillar":
      return { pillar: value === null ? null : String(value) };
    case "strategyNote":
      return { strategyNote: value === null ? null : String(value) };
    case "title":
      return { title: value === null ? "" : String(value) };
    case "assigneeId":
      return { assigneeId: value === null ? null : String(value) };
    case "dueAt":
      return { dueAtIso: value === null ? null : String(value) };
  }
}

export function labelize(value: string) {
  return value.replace(/_/g, " ");
}

/**
 * The empty state should say why the grid is empty in terms of the active
 * scope, not a one-size-fits-all message — "no rows" reads very differently
 * for "nothing exists yet" versus "nothing is assigned to you yet". Built
 * from `label` (from resolvePlanView) rather than duplicating scope logic
 * here, so the wording tracks whatever U2 resolves the scope to.
 */
function emptyStateCopy(scope: PlanScope, label: string): string {
  switch (scope) {
    case "mine":
      return "Nothing assigned to you this month.";
    case "unassigned":
      return "Nothing unassigned this month — every row already has an owner.";
    case "client":
    case "person":
      // `label` already reads as a standalone qualifier ("Aurora Skincare
      // only", "Ada's work") — folding it into "Nothing in X this month"
      // stacked two restrictive qualifiers back to back and read as if
      // "only" scoped the month rather than the client/person. Leading with
      // the month clause keeps `label` as a trailing appositive instead.
      return `This month, nothing shows up for ${label}.`;
    case "all":
    default:
      return "No content this month. Add a card from Production, or accept an idea in Plan & Validate.";
  }
}

/** datetime-local wants "YYYY-MM-DDTHH:mm" in local time, not an ISO-Z. */
export function toLocalInput(iso: string | null, withTime: boolean) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return withTime ? `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

export function PlanGrid({
  workspaceId,
  rows: initialRows,
  members,
  revisions,
  scope,
  grouping,
  label,
  hiddenColumnIds,
  monthParam,
  clientId,
  userId,
  sort,
}: {
  workspaceId: string;
  rows: PlanRowView[];
  members: MemberOption[];
  revisions: RevisionView[];
  /** U2 — which scope resolvePlanView narrowed to; drives the empty state. */
  scope: PlanScope;
  /** U3 — grouping to render the body under; "none" renders flat. */
  grouping: PlanGrouping;
  /** Human-readable scope label from resolvePlanView, for the empty state. */
  label: string;
  /** F5 — custom-field definition ids hidden from the grid, resolved from
   *  the URL on the server the same way scope/grouping are (see page.tsx
   *  and view-controls.tsx). Defaults to "nothing hidden" so a caller that
   *  hasn't opted in (e.g. an existing test) still renders every column. */
  hiddenColumnIds?: string[];
  /** D2 — carried through sort-header links via buildHref, same as
   *  view-controls.tsx's scope/grouping links. Optional so existing tests
   *  that don't care about sort keep working with the date/asc default. */
  monthParam?: string;
  clientId?: string;
  userId?: string;
  sort?: ResolvedPlanSort;
}) {
  const activeSort: ResolvedPlanSort = sort ?? { column: "date", dir: "asc" };
  const sortHref = (column: PlanSortColumn) =>
    buildHref(workspaceId, {
      m: monthParam ?? "",
      scope,
      clientId: scope === "client" ? clientId : undefined,
      userId: scope === "person" ? userId : undefined,
      group: grouping,
      hiddenColumnIds,
      ...toggleSort(activeSort, column),
    });
  const [rows, setRows] = useState(initialRows);
  // F5 — the same definitions + stored values page.tsx fetched once for the
  // detail panel (F4), read via context rather than a second fetch or a
  // second prop thread. See detail-panel.tsx's CustomFieldsContext comment.
  const { definitions: customFieldDefinitions, valuesByContentId } =
    useContext(CustomFieldsContext);
  const visibleColumns = visibleCustomFieldColumns(
    customFieldDefinitions,
    hiddenColumnIds ?? [],
  );
  const [customFieldValues, setCustomFieldValues] = useState<
    Record<string, Record<string, unknown>>
  >(() => valuesByContentId);
  const [customFieldErrors, setCustomFieldErrors] = useState<
    Record<string, Record<string, string>>
  >({});

  async function commitCustomField(
    rowId: string,
    definition: CustomFieldDefinition,
    value: unknown,
  ) {
    const prior = customFieldValues[rowId]?.[definition.id] ?? null;
    // Same optimistic-paint-then-revert shape as commit()/DetailPanel's own
    // commitCustomField: paint immediately, put the prior value back and
    // surface the server's error (re-validated against the live definition)
    // if the write is refused.
    setCustomFieldValues((cur) => ({
      ...cur,
      [rowId]: { ...(cur[rowId] ?? {}), [definition.id]: value },
    }));
    setCustomFieldErrors((cur) => {
      if (!cur[rowId]?.[definition.id]) return cur;
      const nextRow = { ...cur[rowId] };
      delete nextRow[definition.id];
      return { ...cur, [rowId]: nextRow };
    });
    const result = await saveCustomFieldValueAction({
      workspaceId,
      contentId: rowId,
      fieldId: definition.id,
      value,
    });
    if (!result.ok) {
      setCustomFieldValues((cur) => ({
        ...cur,
        [rowId]: { ...(cur[rowId] ?? {}), [definition.id]: prior },
      }));
      setCustomFieldErrors((cur) => ({
        ...cur,
        [rowId]: { ...(cur[rowId] ?? {}), [definition.id]: result.error },
      }));
    }
  }
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  // Which row's detail panel is open (Jira-style: a persistent side panel,
  // not a route — editing there must never lose your place in the list).
  const [detailRowId, setDetailRowId] = useState<string | null>(null);
  const [pending, setPending] = useState(revisions);
  const [saving, startTransition] = useTransition();

  // U5 — multi-select + bulk edit.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Rendered-order index of the last row a checkbox click touched, so a
  // shift-click knows what range to expand — "last clicked", not "last
  // selected": clicking an already-selected row to deselect it still moves
  // the anchor, matching spreadsheet shift-click behaviour.
  const [lastClickedRow, setLastClickedRow] = useState<number | null>(null);
  const [bulkField, setBulkField] = useState<BulkField>("pillar");
  const [bulkValue, setBulkValue] = useState("");

  // U6 — keyboard navigation + fill-down.
  // Coordinate of the most recently focused editable cell — the fill-down
  // anchor. Rendered-order row index paired with an EDITABLE_COLUMNS index.
  const [focusedCell, setFocusedCell] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const cellRefs = useRef(
    new Map<string, HTMLInputElement | HTMLSelectElement>(),
  );

  function registerCell(
    rowIndex: number,
    col: number,
    el: HTMLInputElement | HTMLSelectElement | null,
  ) {
    const key = `${rowIndex}:${col}`;
    if (el) cellRefs.current.set(key, el);
    else cellRefs.current.delete(key);
  }

  /** Arrow/Home/End move focus between editable cells. Tab is deliberately
   *  left alone here — the browser already walks focusable cells left to
   *  right, top to bottom, which is the same order EDITABLE_COLUMNS defines,
   *  so native Tab already does the right thing without help. */
  function handleGridNav(
    e: React.KeyboardEvent<HTMLElement>,
    rowIndex: number,
    col: number,
  ) {
    const navKey = resolveNavKey(e.key, { shift: e.shiftKey });
    if (!navKey || navKey === "Tab" || navKey === "ShiftTab") return;
    e.preventDefault();
    const next = nextCoord(
      { row: rowIndex, col },
      navKey,
      { rowCount: flatRows.length, colCount: EDITABLE_COLUMNS.length },
    );
    cellRefs.current.get(`${next.row}:${next.col}`)?.focus();
  }

  /**
   * Asking for a suggestion never changes the row. The badge count goes up
   * and that is all — the proposed values stay in content_revisions until a
   * human accepts them field by field.
   */
  async function ask(rowId: string) {
    setAsking(rowId);
    setError(null);
    setNotice(null);
    try {
      const result = await askPlanRowAction({
        workspaceId,
        contentId: rowId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRows((cur) =>
        cur.map((r) =>
          r.id === rowId
            ? { ...r, pendingSuggestions: r.pendingSuggestions + 1 }
            : r,
        ),
      );
      setNotice(
        `Suggested ${result.fields.join(", ")} — review before it changes anything.`,
      );
    } finally {
      setAsking(null);
    }
  }

  // Cap applies to the total row set before grouping — a group header is
  // meaningless if it silently drops rows the count didn't account for.
  const visible = showAll ? rows : rows.slice(0, VISIBLE_CAP);
  const groups = groupRows(visible, grouping);
  const scheduledCount = rows.filter((r) => r.scheduledForIso).length;

  // U5/U6 — rendered order, flattened across groups. This is the coordinate
  // space checkboxes, shift-click range, and arrow-key navigation all use —
  // grouping can reorder rows relative to `rows`, and "row 3" for keyboard
  // purposes has to mean the third row actually on screen, not the third row
  // in the ungrouped array.
  const flatRows = groups.flatMap((g) => g.rows);
  const rowIndexById = new Map(flatRows.map((r, i) => [r.id, i]));
  const allVisibleSelected =
    flatRows.length > 0 && flatRows.every((r) => selected.has(r.id));

  function commit(
    rowId: string,
    field: PlanCellField,
    value: string | number | null,
    patch: Partial<PlanRowView>,
  ) {
    const prior = rows.find((r) => r.id === rowId);
    if (!prior) return;
    // Optimistic: paint the new value, then put the old one back if the
    // server refuses. A failed save must visibly revert, never silently
    // swallow — the planner has to know the cell didn't stick.
    setRows((cur) =>
      cur.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
    );
    setError(null);
    startTransition(async () => {
      const result = await updatePlanCellAction({
        workspaceId,
        contentId: rowId,
        field,
        value,
      });
      if (!result.ok) {
        setRows((cur) => cur.map((r) => (r.id === rowId ? prior : r)));
        setError(result.error);
      }
    });
  }

  /**
   * Shared write path for both the bulk-edit bar and fill-down: same
   * optimistic-paint-then-revert shape as commit(), but a per-row patch
   * function (since a type change's duration side effect depends on each
   * row's OWN current duration) and per-row partial-failure handling
   * instead of an all-or-nothing revert.
   *
   * A row that failed reverts to its own prior value; rows that succeeded
   * keep the optimistic paint. Successful ids drop out of the selection so
   * what remains selected is exactly what still needs attention.
   */
  function runBulkWrite(
    contentIds: string[],
    field: PlanCellField,
    value: string | number | null,
    patchFor: (row: PlanRowView) => Partial<PlanRowView>,
  ) {
    if (contentIds.length === 0) return;
    const idSet = new Set(contentIds);
    const priorRows = rows;
    setError(null);
    setNotice(null);
    setRows((cur) =>
      cur.map((r) => (idSet.has(r.id) ? { ...r, ...patchFor(r) } : r)),
    );
    startTransition(async () => {
      const result = await bulkUpdatePlanCellsAction({
        workspaceId,
        contentIds,
        field,
        value,
      });
      if (!result.ok) {
        setRows(priorRows);
        setError(result.error);
        return;
      }
      setSelected((cur) => {
        const next = new Set(cur);
        for (const id of result.updated) next.delete(id);
        return next;
      });
      if (result.failed.length > 0) {
        const failedIds = new Set(result.failed.map((f) => f.id));
        setRows((cur) =>
          cur.map((r) => {
            if (!failedIds.has(r.id)) return r;
            const prior = priorRows.find((p) => p.id === r.id);
            return prior ?? r;
          }),
        );
        setError(
          `${result.failed.length} of ${contentIds.length} row${contentIds.length === 1 ? "" : "s"} couldn't be updated — ${result.failed[0].error}`,
        );
      } else {
        setNotice(
          `Updated ${result.updated.length} row${result.updated.length === 1 ? "" : "s"}.`,
        );
      }
    });
  }

  function toggleRowSelection(rowId: string, rowIndex: number, shiftKey: boolean) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (shiftKey && lastClickedRow !== null) {
        for (const r of expandRowRange(lastClickedRow, rowIndex)) {
          const id = flatRows[r]?.id;
          if (id) next.add(id);
        }
      } else if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
    setLastClickedRow(rowIndex);
  }

  function toggleAllVisible() {
    setSelected((cur) => {
      const next = new Set(cur);
      if (allVisibleSelected) {
        for (const r of flatRows) next.delete(r.id);
      } else {
        for (const r of flatRows) next.add(r.id);
      }
      return next;
    });
  }

  /** Bulk-edit-bar Apply: one field, one value, every selected row. */
  function applyBulk() {
    const contentIds = [...selected];
    let value: string | number | null;
    if (bulkField === "dueAt") {
      value = bulkValue ? new Date(bulkValue).toISOString() : null;
    } else if (bulkField === "assigneeId") {
      value = bulkValue || null;
    } else if (bulkField === "pillar") {
      value = bulkValue.trim() === "" ? null : bulkValue.trim();
    } else {
      value = bulkValue;
    }
    runBulkWrite(contentIds, bulkField, value, (row) =>
      patchForField(bulkField, value, row),
    );
  }

  /** Fill down: copy the anchor cell's value for its column into every
   *  OTHER selected row. Routed through runBulkWrite/bulkUpdatePlanCellsAction
   *  so it inherits the exact same per-row validation a single edit gets. */
  function applyFillDown() {
    if (!focusedCell) return;
    const anchorRow = flatRows[focusedCell.row];
    const column = EDITABLE_COLUMNS[focusedCell.col];
    if (!anchorRow || !column) return;
    const selectedIndexes = [...selected]
      .map((id) => rowIndexById.get(id))
      .filter((i): i is number => i !== undefined);
    const targetIndexes = fillDownTargets(focusedCell.row, selectedIndexes);
    if (targetIndexes.length === 0) return;
    const targetIds = targetIndexes
      .map((i) => flatRows[i]?.id)
      .filter((id): id is string => Boolean(id));
    const value = column.getValue(anchorRow);
    runBulkWrite(targetIds, column.field, value, (row) =>
      patchForField(column.field, value, row),
    );
  }

  if (rows.length === 0) {
    return (
      <p className="mt-6 text-sm text-muted-foreground/70">
        {emptyStateCopy(scope, label)}
      </p>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground/70">
        <span>
          {rows.length} row{rows.length === 1 ? "" : "s"}
          {scheduledCount === 0
            ? " — none scheduled yet; set a date to put them on the calendar"
            : ` · ${scheduledCount} scheduled`}
        </span>
        {saving ? <span className="text-brand-teal">Saving…</span> : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className="mt-2 rounded-md border border-brand-teal/30 bg-brand-teal/10 px-3 py-2 text-sm text-brand-teal">
          {notice}
        </p>
      ) : null}

      {selected.size > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-brand-teal/30 bg-brand-teal/10 px-3 py-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {selected.size} row{selected.size === 1 ? "" : "s"} selected
          </span>

          <select
            aria-label="Bulk edit field"
            className="rounded-sm border border-border bg-transparent px-1.5 py-1 text-xs text-muted-foreground"
            value={bulkField}
            onChange={(e) => {
              const next = e.target.value as BulkField;
              setBulkField(next);
              setBulkValue(next === "type" ? CONTENT_TYPES[0] : "");
            }}
          >
            {BULK_FIELDS.map((f) => (
              <option key={f.field} value={f.field} className="bg-popover">
                {f.label}
              </option>
            ))}
          </select>

          {bulkField === "pillar" ? (
            <input
              type="text"
              aria-label="Bulk pillar value"
              placeholder="Pillar"
              className="rounded-sm border border-border bg-transparent px-1.5 py-1 text-xs text-muted-foreground outline-none focus:border-brand-teal/60"
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
            />
          ) : null}

          {bulkField === "assigneeId" ? (
            <select
              aria-label="Bulk assignee value"
              className="rounded-sm border border-border bg-transparent px-1.5 py-1 text-xs text-muted-foreground"
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
            >
              <option value="" className="bg-popover">
                Unassigned
              </option>
              {members.map((m) => (
                <option key={m.id} value={m.id} className="bg-popover">
                  {m.label}
                </option>
              ))}
            </select>
          ) : null}

          {bulkField === "dueAt" ? (
            <input
              type="date"
              aria-label="Bulk due date value"
              className="rounded-sm border border-border bg-transparent px-1.5 py-1 text-xs text-muted-foreground outline-none focus:border-brand-teal/60"
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
            />
          ) : null}

          {bulkField === "type" ? (
            <select
              aria-label="Bulk type value"
              className="rounded-sm border border-border bg-transparent px-1.5 py-1 text-xs text-muted-foreground"
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
            >
              {CONTENT_TYPES.map((t) => (
                <option key={t} value={t} className="bg-popover">
                  {labelize(t)}
                </option>
              ))}
            </select>
          ) : null}

          <button
            type="button"
            onClick={applyBulk}
            disabled={bulkField === "type" && bulkValue === ""}
            className="rounded-md border border-brand-teal/40 px-2 py-1 text-xs text-brand-teal hover:bg-brand-teal/10 disabled:opacity-40"
          >
            Apply to {selected.size}
          </button>

          {focusedCell && EDITABLE_COLUMNS[focusedCell.col] ? (
            <button
              type="button"
              onClick={applyFillDown}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Fill down {EDITABLE_COLUMNS[focusedCell.col].label} from row{" "}
              {focusedCell.row + 1}
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-muted-foreground/70 hover:text-muted-foreground"
          >
            Clear selection
          </button>
        </div>
      ) : null}

      <div className="mt-3 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[1400px] border-collapse text-left">
          <thead className="sticky top-0 z-20 bg-card">
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground/70">
                <th className="px-2 py-2 font-medium">
                  <input
                    type="checkbox"
                    aria-label="Select all visible rows"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                  />
                </th>
              {[
                { label: "", minW: "" },
                { label: "Date", minW: "min-w-[180px]", sortCol: "date" as const },
                { label: "Client", minW: "min-w-[120px]", sortCol: "client" as const },
                { label: "Type", minW: "min-w-[100px]" },
                { label: "Duration", minW: "min-w-[80px]" },
                { label: "Pillar", minW: "min-w-[120px]", sortCol: "pillar" as const },
                { label: "Strategy", minW: "min-w-[140px]" },
                { label: "Title", minW: "min-w-[180px]", sortCol: "title" as const },
                { label: "Status", minW: "min-w-[90px]", sortCol: "status" as const },
                { label: "Stage", minW: "min-w-[100px]" },
                { label: "Assignee", minW: "min-w-[110px]", sortCol: "assignee" as const },
                { label: "Due", minW: "min-w-[100px]" },
                // F5 — one column per visible custom-field definition
                ...visibleColumns.map((c) => ({ label: c.name, minW: "min-w-[100px]" })),
                { label: "AI", minW: "" },
              ].map((h, i) => (
                <th key={`${h.label}-${i}`} className={cn("px-2 py-2 font-medium", h.minW)}>
                  {/* D2 — only the six whitelisted columns sort, and only
                      when the caller wired monthParam through (existing
                      callers/tests that don't care about sort get plain
                      text, same as before). */}
                  {h.sortCol && monthParam !== undefined ? (
                    <Link
                      href={sortHref(h.sortCol)}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      {h.label}
                      {activeSort.column === h.sortCol
                        ? activeSort.dir === "asc"
                          ? "▲"
                          : "▼"
                        : null}
                    </Link>
                  ) : (
                    h.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.key || "__ungrouped__"}>
                {grouping !== "none" ? (
                  <tr className="border-b border-border bg-muted/50">
                    <td
                      colSpan={14 + visibleColumns.length}
                      className="px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground/70"
                    >
                      {group.key} ({group.rows.length})
                    </td>
                  </tr>
                ) : null}
                {group.rows.map((row) => {
                  const rowIndex = rowIndexById.get(row.id) ?? 0;
                  return (
              <tr
                key={row.id}
                className="border-b border-border last:border-0 hover:bg-muted/50"
              >
                <td className="px-2 py-1">
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.title}`}
                    checked={selected.has(row.id)}
                    onChange={() => {}}
                    onClick={(e) => {
                      e.preventDefault();
                      toggleRowSelection(row.id, rowIndex, e.shiftKey);
                    }}
                  />
                </td>
                <td className="px-1 py-1">
                  <button
                    type="button"
                    aria-label={`Open ${row.title}`}
                    onClick={() => setDetailRowId(row.id)}
                    className="rounded-sm px-1 py-0.5 text-muted-foreground/50 hover:bg-accent hover:text-foreground"
                  >
                    ›
                  </button>
                </td>
                <td className="px-2 py-1">
                  <input
                    type="datetime-local"
                    aria-label="Scheduled for"
                    className={cn(cellClass, "min-w-44")}
                    defaultValue={toLocalInput(row.scheduledForIso, true)}
                    ref={(el) => registerCell(rowIndex, 0, el)}
                    onFocus={() => setFocusedCell({ row: rowIndex, col: 0 })}
                    onKeyDown={(e) => {
                      handleGridNav(e, rowIndex, 0);
                      if (e.key === "Escape") {
                        e.currentTarget.value = toLocalInput(
                          row.scheduledForIso,
                          true,
                        );
                        e.currentTarget.blur();
                      }
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    onBlur={(e) => {
                      const raw = e.target.value;
                      const iso = raw ? new Date(raw).toISOString() : null;
                      if (iso === row.scheduledForIso) return;
                      commit(row.id, "scheduledFor", iso, {
                        scheduledForIso: iso,
                      });
                    }}
                  />
                </td>

                <td className="px-2 py-1 text-sm text-muted-foreground">
                  {row.clientName}
                </td>

                <td className="px-2 py-1">
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        CONTENT_TYPE_COLORS[row.type].dot,
                      )}
                    />
                    <select
                      aria-label="Content type"
                      className={cn(cellClass, "min-w-32")}
                      value={row.type}
                      ref={(el) => registerCell(rowIndex, 1, el)}
                      onFocus={() => setFocusedCell({ row: rowIndex, col: 1 })}
                      onKeyDown={(e) => handleGridNav(e, rowIndex, 1)}
                      onChange={(e) => {
                        const next = e.target.value as ContentType;
                        commit(row.id, "type", next, {
                          type: next,
                          // mirrors the server: a non-video type cannot carry
                          // a duration, so the cell clears with it
                          durationSec: isVideoContentType(next)
                            ? row.durationSec
                            : null,
                        });
                      }}
                    >
                      {CONTENT_TYPES.map((t) => (
                        <option key={t} value={t} className="bg-popover">
                          {labelize(t)}
                        </option>
                      ))}
                    </select>
                  </span>
                </td>

                <td className="px-2 py-1">
                  {isVideoContentType(row.type) ? (
                    <input
                      type="number"
                      min={1}
                      aria-label="Duration in seconds"
                      placeholder="sec"
                      className={cn(cellClass, "w-20")}
                      defaultValue={row.durationSec ?? ""}
                      ref={(el) => registerCell(rowIndex, 2, el)}
                      onFocus={() => setFocusedCell({ row: rowIndex, col: 2 })}
                      onKeyDown={(e) => {
                        handleGridNav(e, rowIndex, 2);
                        if (e.key === "Escape") {
                          e.currentTarget.value = String(row.durationSec ?? "");
                          e.currentTarget.blur();
                        }
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const next = raw === "" ? null : Number(raw);
                        if (next === row.durationSec) return;
                        commit(row.id, "durationSec", next, {
                          durationSec: next,
                        });
                      }}
                    />
                  ) : (
                    <span className="px-1.5 text-sm text-muted-foreground/50">—</span>
                  )}
                </td>

                <td className="px-2 py-1">
                  <EditableText
                    label="Pillar"
                    value={row.pillar}
                    inputRef={(el) => registerCell(rowIndex, 3, el)}
                    onFocusCell={() =>
                      setFocusedCell({ row: rowIndex, col: 3 })
                    }
                    onNav={(e) => handleGridNav(e, rowIndex, 3)}
                    onCommit={(v) =>
                      commit(row.id, "pillar", v, { pillar: v })
                    }
                  />
                </td>

                <td className="px-2 py-1">
                  <EditableText
                    label="Strategy note"
                    value={row.strategyNote}
                    wide
                    inputRef={(el) => registerCell(rowIndex, 4, el)}
                    onFocusCell={() =>
                      setFocusedCell({ row: rowIndex, col: 4 })
                    }
                    onNav={(e) => handleGridNav(e, rowIndex, 4)}
                    onCommit={(v) =>
                      commit(row.id, "strategyNote", v, { strategyNote: v })
                    }
                  />
                </td>

                <td className="px-2 py-1">
                  <EditableText
                    label="Title"
                    value={row.title}
                    wide
                    inputRef={(el) => registerCell(rowIndex, 5, el)}
                    onFocusCell={() =>
                      setFocusedCell({ row: rowIndex, col: 5 })
                    }
                    onNav={(e) => handleGridNav(e, rowIndex, 5)}
                    onCommit={(v) =>
                      commit(row.id, "title", v ?? "", { title: v ?? "" })
                    }
                  />
                </td>

                {/* Workflow state — read-only by design. Moving a card
                    through these goes via approvals and the stage graph. */}
                <td className="px-2 py-1">
                  <Badge
                    variant="outline"
                    className="border-border text-xs text-muted-foreground"
                  >
                    {labelize(row.status)}
                  </Badge>
                  {row.complianceStatus !== "pending" ? (
                    <span className="ml-1 text-xs text-muted-foreground/50">
                      {labelize(row.complianceStatus)}
                    </span>
                  ) : null}
                </td>

                <td className="px-2 py-1 text-sm text-muted-foreground/70">
                  {row.productionStage ? labelize(row.productionStage) : "—"}
                  {row.revisionCount > 0 ? (
                    <span className="ml-1 text-xs text-amber-300/70">
                      ×{row.revisionCount}
                    </span>
                  ) : null}
                </td>

                <td className="px-2 py-1">
                  <select
                    aria-label="Assignee"
                    className={cn(cellClass, "min-w-32")}
                    value={row.assigneeId ?? ""}
                    ref={(el) => registerCell(rowIndex, 6, el)}
                    onFocus={() => setFocusedCell({ row: rowIndex, col: 6 })}
                    onKeyDown={(e) => handleGridNav(e, rowIndex, 6)}
                    onChange={(e) => {
                      const next = e.target.value || null;
                      commit(row.id, "assigneeId", next, { assigneeId: next });
                    }}
                  >
                    <option value="" className="bg-popover">
                      Unassigned
                    </option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id} className="bg-popover">
                        {m.label}
                      </option>
                    ))}
                  </select>
                </td>

                <td className="px-2 py-1">
                  <input
                    type="date"
                    aria-label="Due date"
                    className={cn(cellClass, "min-w-36")}
                    defaultValue={toLocalInput(row.dueAtIso, false)}
                    ref={(el) => registerCell(rowIndex, 7, el)}
                    onFocus={() => setFocusedCell({ row: rowIndex, col: 7 })}
                    onKeyDown={(e) => {
                      handleGridNav(e, rowIndex, 7);
                      if (e.key === "Escape") {
                        e.currentTarget.value = toLocalInput(
                          row.dueAtIso,
                          false,
                        );
                        e.currentTarget.blur();
                      }
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    onBlur={(e) => {
                      const raw = e.target.value;
                      const iso = raw ? new Date(raw).toISOString() : null;
                      if (iso === row.dueAtIso) return;
                      commit(row.id, "dueAt", iso, { dueAtIso: iso });
                    }}
                  />
                </td>

                {/* F5 — one cell per visible custom-field column. Not wired
                    into the arrow-key/fill-down coordinate space: those
                    machinery assume string|number|null (see EDITABLE_COLUMNS
                    and patchForField), but a custom field's value can be a
                    boolean, an array (labels) or an option string — folding
                    that in would mean widening bulk/fill-down beyond what
                    F5 asked for. Saving still goes through the one guarded
                    action every custom-field write uses. */}
                {visibleColumns.map((column) => (
                  <td key={column.id} className="px-2 py-1">
                    <CustomFieldInput
                      definition={column}
                      value={customFieldValues[row.id]?.[column.id] ?? null}
                      onCommit={(value) =>
                        commitCustomField(row.id, column, value)
                      }
                      peopleOptions={members}
                      error={customFieldErrors[row.id]?.[column.id]}
                    />
                  </td>
                ))}

                <td className="px-2 py-1 whitespace-nowrap">
                  <button
                    type="button"
                    disabled={asking === row.id}
                    onClick={() => ask(row.id)}
                    className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    {asking === row.id ? "Asking…" : "Ask AI"}
                  </button>
                  {row.pendingSuggestions > 0 ? (
                    <button
                      type="button"
                      onClick={() => setOpenRow(row.id)}
                      className="ml-1.5 text-xs text-brand-teal underline-offset-2 hover:underline"
                    >
                      {row.pendingSuggestions} suggestion
                      {row.pendingSuggestions === 1 ? "" : "s"}
                    </button>
                  ) : null}
                </td>
              </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {openRow ? (
        <RevisionDrawer
          workspaceId={workspaceId}
          rowTitle={rows.find((r) => r.id === openRow)?.title ?? "This row"}
          revisions={pending.filter((r) => r.contentId === openRow)}
          onClose={() => setOpenRow(null)}
          onResolved={(contentId, revisionId) => {
            // A resolved proposal leaves the pending set whether it was
            // applied or discarded. The row's own values are refreshed by
            // the server revalidate; only the badge is corrected here.
            setPending((cur) =>
              cur.filter(
                (r) => !(r.contentId === contentId && r.id === revisionId),
              ),
            );
            setRows((cur) =>
              cur.map((r) =>
                r.id === contentId
                  ? {
                      ...r,
                      pendingSuggestions: Math.max(
                        0,
                        r.pendingSuggestions - 1,
                      ),
                    }
                  : r,
              ),
            );
          }}
        />
      ) : null}

      {detailRowId
        ? (() => {
            const detailRow = rows.find((r) => r.id === detailRowId);
            if (!detailRow) return null;
            return (
              <DetailPanel
                key={detailRow.id}
                workspaceId={workspaceId}
                row={detailRow}
                members={members}
                // Suppresses the panel's own Escape/outside-click close while
                // the RevisionDrawer it opened is layered on top of it — an
                // Escape meant for the drawer shouldn't also dismiss the
                // panel underneath it.
                suppressClose={openRow === detailRow.id}
                onClose={() => setDetailRowId(null)}
                onOpenSuggestions={() => setOpenRow(detailRow.id)}
                onCommit={(field, value, patch) =>
                  commit(detailRow.id, field, value, patch)
                }
              />
            );
          })()
        : null}

      {!showAll && rows.length > VISIBLE_CAP ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          Show all {rows.length} rows
        </button>
      ) : null}
    </div>
  );
}

function EditableText({
  label,
  value,
  wide,
  onCommit,
  inputRef,
  onFocusCell,
  onNav,
}: {
  label: string;
  value: string | null;
  wide?: boolean;
  onCommit: (value: string | null) => void;
  /** U6 — registers this input for arrow-key focus targeting. */
  inputRef?: (el: HTMLInputElement | null) => void;
  onFocusCell?: () => void;
  onNav?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <input
      type="text"
      aria-label={label}
      placeholder="—"
      className={cn(cellClass, wide ? "min-w-52" : "min-w-32")}
      defaultValue={value ?? ""}
      ref={inputRef}
      onFocus={onFocusCell}
      onKeyDown={(e) => {
        // U6 arrow-key navigation composes with, but never replaces, the
        // Escape/Enter behaviour below.
        onNav?.(e);
        // Escape reverts to the last committed value; Enter commits by
        // blurring. Tab is left to the browser so it walks cells natively.
        if (e.key === "Escape") {
          e.currentTarget.value = value ?? "";
          e.currentTarget.blur();
        }
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      onBlur={(e) => {
        const next = e.target.value.trim();
        const normalized = next === "" ? null : next;
        if (normalized === value) return;
        onCommit(normalized);
      }}
    />
  );
}
