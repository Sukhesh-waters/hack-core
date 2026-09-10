import { describe, expect, it } from "vitest";
import {
  groupRows,
  hasAnyPlanViewParam,
  hiddenColumnsToParam,
  isPlanGrouping,
  isPlanScope,
  isPlanSortColumn,
  isPlanSortDir,
  parseHiddenColumnIds,
  resolvePlanSort,
  resolvePlanView,
  resolveViewParamsWithSavedView,
  toggleSort,
  visibleCustomFieldColumns,
  type GroupableRow,
  type SavedPlanViewLike,
} from "./plan-view";

const VIEWER = "user_me";

describe("resolvePlanView — scope resolution (U2)", () => {
  it("defaults to all clients", () => {
    const view = resolvePlanView({}, VIEWER);
    expect(view.scope).toBe("all");
    expect(view.filter).toEqual({});
    expect(view.label).toBe("All clients");
  });

  it("narrows to one client", () => {
    const view = resolvePlanView(
      { scope: "client", clientId: "c_1" },
      VIEWER,
      () => "Aurora Skincare",
    );
    expect(view.filter).toEqual({ clientId: "c_1" });
    expect(view.label).toBe("Aurora Skincare only");
  });

  it("resolves 'mine' to the viewer, never a client-supplied id", () => {
    const view = resolvePlanView({ scope: "mine", userId: "someone" }, VIEWER);
    expect(view.filter).toEqual({ assigneeId: VIEWER });
  });

  it("narrows to a named person", () => {
    const view = resolvePlanView(
      { scope: "person", userId: "user_2" },
      VIEWER,
      undefined,
      () => "Dev Bypass User",
    );
    expect(view.filter).toEqual({ assigneeId: "user_2" });
    expect(view.label).toBe("Dev Bypass User's work");
  });

  it("surfaces unowned rows", () => {
    const view = resolvePlanView({ scope: "unassigned" }, VIEWER);
    expect(view.filter).toEqual({ unassignedOnly: true });
  });

  /**
   * A bad or half-built link should show the default view, not a broken
   * page — these come from bookmarks and pasted URLs.
   */
  it("degrades a malformed scope to all", () => {
    expect(resolvePlanView({ scope: "../etc" }, VIEWER).scope).toBe("all");
  });

  it("degrades a scope missing the id it needs", () => {
    expect(resolvePlanView({ scope: "client" }, VIEWER).filter).toEqual({});
    expect(resolvePlanView({ scope: "person" }, VIEWER).filter).toEqual({});
  });

  it("falls back to a generic label when the name can't be resolved", () => {
    const view = resolvePlanView({ scope: "client", clientId: "c_9" }, VIEWER);
    expect(view.label).toBe("One client");
  });

  it("carries grouping independently of scope", () => {
    const view = resolvePlanView({ group: "pillar" }, VIEWER);
    expect(view.grouping).toBe("pillar");
    expect(view.scope).toBe("all");
  });

  it("degrades a malformed grouping to none", () => {
    expect(resolvePlanView({ group: "nope" }, VIEWER).grouping).toBe("none");
  });
});

describe("scope and grouping guards", () => {
  it("accepts only known values", () => {
    expect(isPlanScope("mine")).toBe(true);
    expect(isPlanScope("everything")).toBe(false);
    expect(isPlanScope(undefined)).toBe(false);
    expect(isPlanGrouping("client")).toBe(true);
    expect(isPlanGrouping("")).toBe(false);
  });
});

describe("sort column/direction guards (D2 — SQL-injection whitelist)", () => {
  it("accepts only the six known columns", () => {
    expect(isPlanSortColumn("date")).toBe(true);
    expect(isPlanSortColumn("client")).toBe(true);
    expect(isPlanSortColumn("status")).toBe(true);
    expect(isPlanSortColumn("pillar")).toBe(true);
    expect(isPlanSortColumn("assignee")).toBe(true);
    expect(isPlanSortColumn("title")).toBe(true);
    expect(isPlanSortColumn("id; DROP TABLE content;--")).toBe(false);
    expect(isPlanSortColumn(undefined)).toBe(false);
  });

  it("accepts only asc/desc", () => {
    expect(isPlanSortDir("asc")).toBe(true);
    expect(isPlanSortDir("desc")).toBe(true);
    expect(isPlanSortDir("ASC; --")).toBe(false);
    expect(isPlanSortDir(undefined)).toBe(false);
  });
});

describe("resolvePlanSort — whitelist resolution (D2)", () => {
  it("defaults to date/asc — the grid's original fixed order", () => {
    expect(resolvePlanSort({})).toEqual({ column: "date", dir: "asc" });
  });

  it("resolves a known column and direction", () => {
    expect(resolvePlanSort({ sort: "client", dir: "desc" })).toEqual({
      column: "client",
      dir: "desc",
    });
  });

  it("an unknown column falls back to the default rather than reaching SQL", () => {
    expect(
      resolvePlanSort({ sort: "id; DROP TABLE content;--", dir: "asc" }),
    ).toEqual({ column: "date", dir: "asc" });
  });

  it("an unknown direction falls back to asc", () => {
    expect(resolvePlanSort({ sort: "status", dir: "sideways" })).toEqual({
      column: "status",
      dir: "asc",
    });
  });
});

describe("toggleSort — header-click behavior (D2)", () => {
  it("clicking the active column flips direction", () => {
    expect(toggleSort({ column: "client", dir: "asc" }, "client")).toEqual({
      column: "client",
      dir: "desc",
    });
    expect(toggleSort({ column: "client", dir: "desc" }, "client")).toEqual({
      column: "client",
      dir: "asc",
    });
  });

  it("clicking a different column resets to ascending", () => {
    expect(toggleSort({ column: "client", dir: "desc" }, "status")).toEqual({
      column: "status",
      dir: "asc",
    });
  });
});

describe("groupRows — grouped sections with counts (U3)", () => {
  const row = (
    clientName: string,
    status: string,
    pillar: string | null,
  ): GroupableRow => ({ clientName, status, pillar });

  const rows = [
    row("Aurora", "draft", "Education"),
    row("SLAM", "scheduled", null),
    row("Aurora", "scheduled", "Education"),
    row("SLAM", "draft", "Proof"),
  ];

  it("returns one anonymous bucket when grouping is off", () => {
    const groups = groupRows(rows, "none");
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(4);
  });

  it("groups by client with truthful counts", () => {
    const groups = groupRows(rows, "client");
    expect(groups.map((g) => g.key)).toEqual(["Aurora", "SLAM"]);
    expect(groups.map((g) => g.rows.length)).toEqual([2, 2]);
  });

  it("groups by status", () => {
    const groups = groupRows(rows, "status");
    expect(groups.map((g) => g.key)).toEqual(["draft", "scheduled"]);
  });

  /**
   * The query already sorted by date with undated last. Regrouping must not
   * silently reorder within a bucket, or the grid stops matching the
   * ordering the planner just chose.
   */
  it("preserves incoming order inside each bucket", () => {
    const ordered = [
      row("Aurora", "first", null),
      row("SLAM", "x", null),
      row("Aurora", "second", null),
      row("Aurora", "third", null),
    ];
    const aurora = groupRows(ordered, "client").find(
      (g) => g.key === "Aurora",
    );
    expect(aurora?.rows.map((r) => r.status)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("labels rows with no pillar and sorts that bucket last", () => {
    const groups = groupRows(rows, "pillar");
    expect(groups.map((g) => g.key)).toEqual([
      "Education",
      "Proof",
      "No pillar",
    ]);
  });

  it("never emits an empty group, so every count is real", () => {
    for (const grouping of ["client", "status", "pillar"] as const) {
      for (const group of groupRows(rows, grouping)) {
        expect(group.rows.length).toBeGreaterThan(0);
      }
    }
  });

  it("handles an empty row set without inventing groups", () => {
    expect(groupRows([], "client")).toEqual([]);
    expect(groupRows([], "none")).toEqual([{ key: "", rows: [] }]);
  });
});

describe("hidden custom-field column params (F5)", () => {
  it("parses a comma list, trimming and dropping empties", () => {
    expect(parseHiddenColumnIds("f1, f2 ,f3")).toEqual(["f1", "f2", "f3"]);
    expect(parseHiddenColumnIds("f1,,f2")).toEqual(["f1", "f2"]);
  });

  it("treats a missing or blank param as nothing hidden", () => {
    expect(parseHiddenColumnIds(undefined)).toEqual([]);
    expect(parseHiddenColumnIds("")).toEqual([]);
  });

  it("serializes hidden ids back to a comma param", () => {
    expect(hiddenColumnsToParam(["f1", "f2"])).toBe("f1,f2");
  });

  it("omits the param entirely when nothing is hidden, rather than an empty string", () => {
    expect(hiddenColumnsToParam([])).toBeUndefined();
  });

  it("dedupes and trims when serializing", () => {
    expect(hiddenColumnsToParam(["f1", " f1", "f2", "f1"])).toBe("f1,f2");
  });

  it("round-trips through parse/serialize", () => {
    const ids = ["f1", "f2", "f3"];
    expect(parseHiddenColumnIds(hiddenColumnsToParam(ids))).toEqual(ids);
  });
});

describe("visibleCustomFieldColumns — column resolution (F5)", () => {
  const fields = [{ id: "f1" }, { id: "f2" }, { id: "f3" }];

  it("shows every field when nothing is hidden", () => {
    expect(visibleCustomFieldColumns(fields, [])).toEqual(fields);
  });

  it("filters out hidden ids, preserving the incoming order", () => {
    expect(visibleCustomFieldColumns(fields, ["f2"])).toEqual([
      { id: "f1" },
      { id: "f3" },
    ]);
  });

  it("hides multiple fields", () => {
    expect(visibleCustomFieldColumns(fields, ["f1", "f3"])).toEqual([
      { id: "f2" },
    ]);
  });

  /**
   * The whole point of storing what's HIDDEN rather than what's VISIBLE: a
   * field the hidden list has never heard of (created after the link was
   * captured, or simply never mentioned) must render, not vanish.
   */
  it("shows a field not named in the hidden list, even a newly added one", () => {
    const withNewField = [...fields, { id: "f4-new" }];
    expect(visibleCustomFieldColumns(withNewField, ["f2"])).toEqual([
      { id: "f1" },
      { id: "f3" },
      { id: "f4-new" },
    ]);
  });

  it("tolerates a hidden id with no matching definition", () => {
    expect(visibleCustomFieldColumns(fields, ["ghost-id"])).toEqual(fields);
  });

  it("returns an empty list when every field is hidden", () => {
    expect(visibleCustomFieldColumns(fields, ["f1", "f2", "f3"])).toEqual([]);
  });

  it("handles an empty definition set without error", () => {
    expect(visibleCustomFieldColumns([], ["f1"])).toEqual([]);
  });
});

describe("hasAnyPlanViewParam — presence check (U7)", () => {
  it("is false when the URL carries none of the five params", () => {
    expect(hasAnyPlanViewParam({})).toBe(false);
  });

  it("is true for each param individually, even an empty string", () => {
    expect(hasAnyPlanViewParam({ scope: "" })).toBe(true);
    expect(hasAnyPlanViewParam({ clientId: "c_1" })).toBe(true);
    expect(hasAnyPlanViewParam({ userId: "u_1" })).toBe(true);
    expect(hasAnyPlanViewParam({ group: "client" })).toBe(true);
    expect(hasAnyPlanViewParam({ hiddenCols: "f1" })).toBe(true);
  });
});

describe("resolveViewParamsWithSavedView — URL-beats-saved precedence (U7)", () => {
  const savedView: SavedPlanViewLike = {
    scope: "client",
    clientId: "c_saved",
    userId: null,
    grouping: "pillar",
    hiddenColumns: ["f_saved"],
  };

  it("applies the saved view on a bare visit with no view params", () => {
    const resolved = resolveViewParamsWithSavedView({}, savedView);
    expect(resolved).toEqual({
      scope: "client",
      clientId: "c_saved",
      userId: undefined,
      group: "pillar",
      hiddenCols: "f_saved",
    });
  });

  it("an explicit URL param wins outright — the saved view is not consulted for ANY field", () => {
    // Only `scope` is on the URL; grouping/hiddenCols are absent. Even so,
    // the saved view's pillar grouping and hidden columns must NOT leak in —
    // partial merging would produce a view nobody asked for.
    const resolved = resolveViewParamsWithSavedView(
      { scope: "mine" },
      savedView,
    );
    expect(resolved).toEqual({ scope: "mine" });
  });

  it("an explicit empty-string param still counts as present", () => {
    const resolved = resolveViewParamsWithSavedView(
      { group: "" },
      savedView,
    );
    expect(resolved).toEqual({ group: "" });
  });

  it("passes URL params through untouched when there is no saved view", () => {
    const urlParams = { scope: "unassigned" as const };
    expect(resolveViewParamsWithSavedView(urlParams, null)).toEqual(urlParams);
  });

  it("passes an empty URL through untouched when there is no saved view either", () => {
    expect(resolveViewParamsWithSavedView({}, null)).toEqual({});
  });

  it("omits hiddenCols entirely when the saved view hides nothing", () => {
    const noHidden: SavedPlanViewLike = { ...savedView, hiddenColumns: [] };
    const resolved = resolveViewParamsWithSavedView({}, noHidden);
    expect(resolved.hiddenCols).toBeUndefined();
  });

  it("carries a null saved clientId/userId as undefined, not the string 'null'", () => {
    const allScope: SavedPlanViewLike = {
      scope: "all",
      clientId: null,
      userId: null,
      grouping: "none",
      hiddenColumns: [],
    };
    const resolved = resolveViewParamsWithSavedView({}, allScope);
    expect(resolved.clientId).toBeUndefined();
    expect(resolved.userId).toBeUndefined();
  });
});
