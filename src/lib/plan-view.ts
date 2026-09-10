/**
 * U2/U3 — how the plan grid is scoped and grouped.
 *
 * Kept out of the page component so the URL contract is one testable place.
 * Every value round-trips through the query string, which means a planner
 * can bookmark or share "Aurora's reels grouped by status" as a link — the
 * cheapest possible version of saved views, before U7 stores them.
 */

export const PLAN_SCOPES = [
  "all",
  "client",
  "mine",
  "person",
  "unassigned",
] as const;
export type PlanScope = (typeof PLAN_SCOPES)[number];

export const PLAN_GROUPINGS = ["none", "client", "status", "pillar"] as const;
export type PlanGrouping = (typeof PLAN_GROUPINGS)[number];

export function isPlanScope(value: string | undefined): value is PlanScope {
  return (PLAN_SCOPES as readonly string[]).includes(value ?? "");
}

export function isPlanGrouping(
  value: string | undefined,
): value is PlanGrouping {
  return (PLAN_GROUPINGS as readonly string[]).includes(value ?? "");
}

/**
 * D2 — the plan grid's sortable columns, as a closed whitelist. This exists
 * because `sort`/`dir` arrive as raw URL strings, and `planGridQuery`'s
 * `orderBy` is built from them: the whitelist is security (never
 * interpolate a user string into SQL), not just UX polish. An unknown
 * value degrades to the default sort, same as an unknown scope/grouping.
 */
export const PLAN_SORT_COLUMNS = [
  "date",
  "client",
  "status",
  "pillar",
  "assignee",
  "title",
] as const;
export type PlanSortColumn = (typeof PLAN_SORT_COLUMNS)[number];

export const PLAN_SORT_DIRS = ["asc", "desc"] as const;
export type PlanSortDir = (typeof PLAN_SORT_DIRS)[number];

export function isPlanSortColumn(
  value: string | undefined,
): value is PlanSortColumn {
  return (PLAN_SORT_COLUMNS as readonly string[]).includes(value ?? "");
}

export function isPlanSortDir(value: string | undefined): value is PlanSortDir {
  return (PLAN_SORT_DIRS as readonly string[]).includes(value ?? "");
}

export type ResolvedPlanSort = { column: PlanSortColumn; dir: PlanSortDir };

/** Defaults to date/asc — the grid's original fixed order — so a link with
 *  no sort param behaves exactly as it always has. */
export function resolvePlanSort(params: {
  sort?: string;
  dir?: string;
}): ResolvedPlanSort {
  return {
    column: isPlanSortColumn(params.sort) ? params.sort : "date",
    dir: isPlanSortDir(params.dir) ? params.dir : "asc",
  };
}

/** The header-click toggle: same column flips direction, a different
 *  column resets to ascending — the conventional spreadsheet behavior. */
export function toggleSort(
  current: ResolvedPlanSort,
  clicked: PlanSortColumn,
): ResolvedPlanSort {
  if (current.column !== clicked) return { column: clicked, dir: "asc" };
  return { column: clicked, dir: current.dir === "asc" ? "desc" : "asc" };
}

export type PlanViewParams = {
  scope?: string;
  clientId?: string;
  userId?: string;
  group?: string;
};

export type ResolvedPlanView = {
  scope: PlanScope;
  grouping: PlanGrouping;
  /** Passed straight to planGridQuery. */
  filter: {
    clientId?: string;
    assigneeId?: string;
    unassignedOnly?: boolean;
  };
  /** Human-readable, for the empty state and the header. */
  label: string;
};

/**
 * Resolves URL params into a query filter.
 *
 * Falls back to "all" rather than erroring on a malformed scope: a bad link
 * should show the default view, not a broken page. A scope that needs an id
 * it wasn't given (client without clientId) also degrades to "all" for the
 * same reason.
 */
export function resolvePlanView(
  params: PlanViewParams,
  viewerId: string,
  clientNameById?: (id: string) => string | undefined,
  personNameById?: (id: string) => string | undefined,
): ResolvedPlanView {
  const grouping = isPlanGrouping(params.group) ? params.group : "none";
  const scope = isPlanScope(params.scope) ? params.scope : "all";

  if (scope === "client" && params.clientId) {
    const name = clientNameById?.(params.clientId);
    return {
      scope,
      grouping,
      filter: { clientId: params.clientId },
      label: name ? `${name} only` : "One client",
    };
  }

  if (scope === "mine") {
    return {
      scope,
      grouping,
      filter: { assigneeId: viewerId },
      label: "Assigned to me",
    };
  }

  if (scope === "person" && params.userId) {
    const name = personNameById?.(params.userId);
    return {
      scope,
      grouping,
      filter: { assigneeId: params.userId },
      label: name ? `${name}'s work` : "One person",
    };
  }

  if (scope === "unassigned") {
    return {
      scope,
      grouping,
      filter: { unassignedOnly: true },
      label: "Unassigned",
    };
  }

  return { scope: "all", grouping, filter: {}, label: "All clients" };
}

/**
 * F5 — the URL param that carries which custom-field columns are hidden on
 * the plan grid. Named "hidden", not "visible", to match the schema
 * `plan_view_preferences.hiddenColumns` will eventually persist (U7): a
 * field created after a link was shared or a view was saved must appear by
 * default, which only holds if the stored/URL-carried list names what's
 * hidden rather than what's shown.
 */
export const HIDDEN_COLUMNS_PARAM = "hiddenCols";

/** Comma-separated field ids from the URL, trimmed and with empties
 *  dropped. A missing or blank param means nothing is hidden. */
export function parseHiddenColumnIds(param: string | undefined): string[] {
  if (!param) return [];
  return param
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/** Inverse of parseHiddenColumnIds. Returns undefined (never an empty
 *  string) when nothing is hidden, so a fully-visible view omits the param
 *  entirely instead of appending "?hiddenCols=" to every link. */
export function hiddenColumnsToParam(hiddenColumnIds: string[]): string | undefined {
  const cleaned = [...new Set(hiddenColumnIds.map((id) => id.trim()).filter(Boolean))];
  return cleaned.length > 0 ? cleaned.join(",") : undefined;
}

/**
 * F5 — which custom-field definitions render as grid columns, given the
 * caller's hidden-id list.
 *
 * Pure and generic (keyed only on `id`) so it can be tested without a real
 * CustomFieldDefinition or touching React. Order is whatever `definitions`
 * arrived in — this filters, it never reorders — and a definition whose id
 * isn't in `hiddenColumnIds` is visible by construction, so a field added
 * after a link was captured shows up without anyone opting it back in.
 */
export function visibleCustomFieldColumns<T extends { id: string }>(
  definitions: T[],
  hiddenColumnIds: string[],
): T[] {
  if (hiddenColumnIds.length === 0) return definitions;
  const hidden = new Set(hiddenColumnIds);
  return definitions.filter((d) => !hidden.has(d.id));
}

/**
 * U7 — the raw view params as they arrive on the URL, before resolution.
 * `undefined` means "this param is not in the query string at all", which is
 * distinct from an empty string — a link that explicitly clears grouping
 * still counts as "the URL carries a view param" for precedence purposes.
 */
export type PlanViewUrlParams = {
  scope?: string;
  clientId?: string;
  userId?: string;
  group?: string;
  hiddenCols?: string;
};

/**
 * A saved view, expressed structurally rather than imported from
 * `db/queries/plan-views` — that module already imports `isPlanScope` /
 * `isPlanGrouping` from here, and importing its `SavedPlanView` type back
 * would make this file depend on the query layer for no reason. The shape
 * below is exactly `SavedPlanView`'s; TypeScript's structural typing makes
 * the two interchangeable at call sites without a circular import.
 */
export type SavedPlanViewLike = {
  scope: PlanScope;
  clientId: string | null;
  userId: string | null;
  grouping: PlanGrouping;
  hiddenColumns: string[];
};

/** True when the URL names at least one view-affecting param, however it
 *  was set (including to an already-default value). */
export function hasAnyPlanViewParam(params: PlanViewUrlParams): boolean {
  return (
    params.scope !== undefined ||
    params.clientId !== undefined ||
    params.userId !== undefined ||
    params.group !== undefined ||
    params.hiddenCols !== undefined
  );
}

/**
 * U7 — the precedence rule for saved views: an explicit URL always wins.
 *
 * A stored preference exists to restore "what I had open" on a bare visit,
 * never to override a link someone deliberately shared or bookmarked — a
 * teammate sending `?scope=mine` must see "mine", not whatever the recipient
 * saved for themselves last week. So the saved view is only substituted in
 * when the URL carries NONE of the five params below; if even one is
 * present, the URL is taken as-is and the saved view is not consulted for
 * any of the others either (partial merging would produce a view nobody
 * asked for and nobody saved).
 *
 * Pure and framework-free so the precedence itself is unit-testable without
 * a request, a session, or a database.
 */
export function resolveViewParamsWithSavedView(
  urlParams: PlanViewUrlParams,
  savedView: SavedPlanViewLike | null,
): PlanViewUrlParams {
  if (hasAnyPlanViewParam(urlParams) || !savedView) return urlParams;

  return {
    scope: savedView.scope,
    clientId: savedView.clientId ?? undefined,
    userId: savedView.userId ?? undefined,
    group: savedView.grouping,
    hiddenCols:
      savedView.hiddenColumns.length > 0
        ? savedView.hiddenColumns.join(",")
        : undefined,
  };
}

export type GroupableRow = {
  clientName: string;
  status: string;
  pillar: string | null;
};

/** The bucket a row belongs to under the current grouping. */
export function groupKeyFor(row: GroupableRow, grouping: PlanGrouping): string {
  switch (grouping) {
    case "client":
      return row.clientName;
    case "status":
      return row.status;
    case "pillar":
      return row.pillar ?? "No pillar";
    case "none":
      return "";
  }
}

/**
 * Groups rows preserving the incoming order inside each bucket — the query
 * already sorted by date with undated last, and regrouping must not silently
 * reorder within a group.
 *
 * Empty groups are impossible by construction (a group only exists because a
 * row created it), which is why counts here are always truthful.
 */
export function groupRows<T extends GroupableRow>(
  rows: T[],
  grouping: PlanGrouping,
): { key: string; rows: T[] }[] {
  if (grouping === "none") return [{ key: "", rows }];

  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const key = groupKeyFor(row, grouping);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  // "No pillar" sorts last; everything else alphabetically. An unlabelled
  // bucket is a gap to fill, not the headline.
  return [...buckets.entries()]
    .map(([key, groupedRows]) => ({ key, rows: groupedRows }))
    .sort((a, b) => {
      if (a.key === "No pillar") return 1;
      if (b.key === "No pillar") return -1;
      return a.key.localeCompare(b.key);
    });
}
