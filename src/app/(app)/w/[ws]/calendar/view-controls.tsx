"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  hiddenColumnsToParam,
  HIDDEN_COLUMNS_PARAM,
  type PlanGrouping,
  type PlanScope,
  type PlanSortColumn,
  type PlanSortDir,
} from "@/lib/plan-view";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { savePlanViewAction } from "./view-actions";

export type ViewControlsClient = { id: string; name: string };
export type ViewControlsPerson = { id: string; label: string };
/** F5 — just enough of a custom-field definition to label a column toggle. */
export type ViewControlsCustomField = { id: string; name: string };

const GROUPING_TABS: { value: PlanGrouping; label: string }[] = [
  { value: "none", label: "No grouping" },
  { value: "client", label: "By client" },
  { value: "status", label: "By status" },
  { value: "pillar", label: "By pillar" },
];

/**
 * Builds the calendar grid URL for a given combination of params, always
 * preserving month + view=grid. Scope-specific ids are only included when
 * they're relevant to the target scope — a stale clientId shouldn't tag
 * along onto a "mine" link.
 */
export function buildHref(
  ws: string,
  params: {
    m: string;
    scope?: PlanScope;
    clientId?: string;
    userId?: string;
    group?: PlanGrouping;
    /** F5 — carried through every link so switching scope/grouping doesn't
     *  reset a column-visibility choice the planner already made. */
    hiddenColumnIds?: string[];
    /** D2 — carried through every link the same way, so switching scope
     *  or grouping doesn't silently reset a chosen sort. */
    sort?: PlanSortColumn;
    dir?: PlanSortDir;
  },
) {
  const sp = new URLSearchParams();
  sp.set("m", params.m);
  sp.set("view", "grid");
  if (params.scope && params.scope !== "all") sp.set("scope", params.scope);
  if (params.clientId) sp.set("clientId", params.clientId);
  if (params.userId) sp.set("userId", params.userId);
  if (params.group && params.group !== "none") sp.set("group", params.group);
  const hiddenParam = hiddenColumnsToParam(params.hiddenColumnIds ?? []);
  if (hiddenParam) sp.set(HIDDEN_COLUMNS_PARAM, hiddenParam);
  if (params.sort && params.sort !== "date") sp.set("sort", params.sort);
  if (params.dir && params.dir !== "asc") sp.set("dir", params.dir);
  return `/w/${ws}/calendar?${sp.toString()}`;
}

/**
 * Scope + grouping switcher for the plan grid.
 *
 * These are URL-driven links (and two selects that navigate on change),
 * not client-side state: the page is a server component that refetches
 * `listPlanGrid` per combination, and a bookmarked/shared link must
 * reproduce the exact same view. Keeping the current selection in React
 * state instead would desync from what the server actually rendered the
 * moment someone reloads or shares the URL.
 */
export function ViewControls({
  ws,
  monthParam,
  scope,
  grouping,
  clientId,
  userId,
  clients,
  members,
  customFields = [],
  hiddenColumnIds = [],
  sort = "date",
  dir = "asc",
}: {
  ws: string;
  monthParam: string;
  scope: PlanScope;
  grouping: PlanGrouping;
  clientId?: string;
  userId?: string;
  clients: ViewControlsClient[];
  members: ViewControlsPerson[];
  /** F5 — content-subject custom-field definitions, for the column toggle.
   *  Empty when there are none to show (nothing to toggle). */
  customFields?: ViewControlsCustomField[];
  /** F5 — ids currently hidden from the grid; drives which toggles are
   *  unchecked and is carried through every other link on this bar. */
  hiddenColumnIds?: string[];
  /** D2 — carried through every link below so switching scope/grouping/
   *  columns doesn't silently reset a chosen sort. */
  sort?: PlanSortColumn;
  dir?: PlanSortDir;
}) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [saveStatus, setSaveStatus] = useState<
    { kind: "ok" } | { kind: "error"; message: string } | null
  >(null);

  /**
   * U7 — "Save this view" persists exactly what's currently on screen
   * (scope, grouping, hidden columns) as this user's remembered default for
   * this workspace. It does NOT navigate — the URL already reflects this
   * view, so there's nothing to change on screen, only a row to write.
   */
  function saveCurrentView() {
    setSaveStatus(null);
    startSaving(async () => {
      const result = await savePlanViewAction({
        workspaceId: ws,
        scope,
        clientId: scope === "client" ? clientId : undefined,
        targetUserId: scope === "person" ? userId : undefined,
        grouping,
        hiddenColumns: hiddenColumnIds,
      });
      setSaveStatus(
        result.ok ? { kind: "ok" } : { kind: "error", message: result.error },
      );
    });
  }

  /** Flips one field's visibility and navigates — same URL-is-truth pattern
   *  as the client/person selects below, just for a different param. */
  function toggleColumn(fieldId: string, nextVisible: boolean) {
    const next = nextVisible
      ? hiddenColumnIds.filter((id) => id !== fieldId)
      : [...hiddenColumnIds, fieldId];
    router.push(
      buildHref(ws, {
        m: monthParam,
        scope,
        clientId: scope === "client" ? clientId : undefined,
        userId: scope === "person" ? userId : undefined,
        group: grouping,
        hiddenColumnIds: next,
        sort,
        dir,
      }),
    );
  }

  const tabClass = (active: boolean) =>
    cn(
      "rounded-md border px-2.5 py-1",
      active
        ? "border-brand-teal/50 bg-brand-teal/10 text-foreground"
        : "border-border text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        <Link
          href={buildHref(ws, {
            m: monthParam,
            scope: "all",
            group: grouping,
            hiddenColumnIds,
            sort,
            dir,
          })}
          aria-current={scope === "all" ? "page" : undefined}
          className={tabClass(scope === "all")}
        >
          All clients
        </Link>

        <select
          aria-label="Filter to one client"
          className={tabClass(scope === "client")}
          value={scope === "client" ? (clientId ?? "") : ""}
          onChange={(e) => {
            const next = e.target.value;
            if (!next) return;
            router.push(
              buildHref(ws, {
                m: monthParam,
                scope: "client",
                clientId: next,
                group: grouping,
                hiddenColumnIds,
                sort,
                dir,
              }),
            );
          }}
        >
          <option value="" className="bg-popover">
            One client…
          </option>
          {clients.map((c) => (
            <option key={c.id} value={c.id} className="bg-popover">
              {c.name}
            </option>
          ))}
        </select>

        <Link
          href={buildHref(ws, {
            m: monthParam,
            scope: "mine",
            group: grouping,
            hiddenColumnIds,
            sort,
            dir,
          })}
          aria-current={scope === "mine" ? "page" : undefined}
          className={tabClass(scope === "mine")}
        >
          Assigned to me
        </Link>

        <select
          aria-label="Someone else"
          className={tabClass(scope === "person")}
          value={scope === "person" ? (userId ?? "") : ""}
          onChange={(e) => {
            const next = e.target.value;
            if (!next) return;
            router.push(
              buildHref(ws, {
                m: monthParam,
                scope: "person",
                userId: next,
                group: grouping,
                hiddenColumnIds,
                sort,
                dir,
              }),
            );
          }}
        >
          <option value="" className="bg-popover">
            Someone else…
          </option>
          {members.map((m) => (
            <option key={m.id} value={m.id} className="bg-popover">
              {m.label}
            </option>
          ))}
        </select>

        <Link
          href={buildHref(ws, {
            m: monthParam,
            scope: "unassigned",
            group: grouping,
            hiddenColumnIds,
            sort,
            dir,
          })}
          aria-current={scope === "unassigned" ? "page" : undefined}
          className={tabClass(scope === "unassigned")}
        >
          Unassigned
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-l border-border pl-3">
        {GROUPING_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={buildHref(ws, {
              m: monthParam,
              scope,
              clientId: scope === "client" ? clientId : undefined,
              userId: scope === "person" ? userId : undefined,
              group: tab.value,
              hiddenColumnIds,
              sort,
              dir,
            })}
            aria-current={grouping === tab.value ? "page" : undefined}
            className={tabClass(grouping === tab.value)}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {customFields.length > 0 ? (
        <div className="border-l border-border pl-3">
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "rounded-md border px-2.5 py-1",
                "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              Columns
              {hiddenColumnIds.length > 0
                ? ` (${hiddenColumnIds.length} hidden)`
                : ""}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Custom field columns</DropdownMenuLabel>
              {customFields.map((field) => {
                const visible = !hiddenColumnIds.includes(field.id);
                return (
                  <DropdownMenuCheckboxItem
                    key={field.id}
                    checked={visible}
                    onCheckedChange={(next) => toggleColumn(field.id, next)}
                  >
                    {field.name}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}

      <div className="flex items-center gap-2 border-l border-border pl-3">
        <button
          type="button"
          onClick={saveCurrentView}
          disabled={saving}
          className="rounded-md border border-border px-2.5 py-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save this view"}
        </button>
        {saveStatus?.kind === "ok" ? (
          <span className="text-brand-teal">Saved</span>
        ) : null}
        {saveStatus?.kind === "error" ? (
          <span className="text-destructive">{saveStatus.message}</span>
        ) : null}
      </div>
    </div>
  );
}
