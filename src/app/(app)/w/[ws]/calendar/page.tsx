import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { content } from "@/db/schema";
import { requireUser } from "@/auth";
import { listClients } from "@/db/queries/clients";
import { listWorkspaceMembers } from "@/db/queries/memberships";
import { listFieldsForSubject } from "@/db/queries/custom-fields";
import type { CustomFieldDefinition } from "@/lib/custom-fields";
import { getSavedPlanView } from "@/db/queries/plan-views";
import {
  pendingRevisionCounts,
  pendingRevisionsForContents,
} from "@/db/queries/revisions";
import {
  listPlanGrid,
  listScheduledSlots,
  listScheduledSopSteps,
} from "@/db/queries/schedule";
import {
  groupByDay,
  isOverdueSlot,
  monthGrid,
  monthGridRange,
  publishChecklist,
} from "@/lib/calendar";
import type { ContentType } from "@/lib/colors";
import {
  hasAnyPlanViewParam,
  parseHiddenColumnIds,
  resolvePlanSort,
  resolvePlanView,
  resolveViewParamsWithSavedView,
  type PlanViewUrlParams,
} from "@/lib/plan-view";
import { CalendarBoard, type CalendarDayView } from "./calendar-board";
import { CustomFieldsProvider } from "./detail-panel";
import { PlanGrid } from "./plan-grid";
import { ViewControls } from "./view-controls";
import { CalendarLive } from "./calendar-live";
import { PageShell } from "@/components/page-shell";

/**
 * F4 — one bulk, workspace-scoped fetch of every grid row's stored custom
 * field values, keyed by content id. listPlanGrid's projection has no
 * customFields column (it's a hand-picked set of plan-cell fields), so this
 * fills that one gap with the same "batch by the already-capped gridIds"
 * shape pendingRevisionCounts/pendingRevisionsForContents use just below —
 * one query for the whole page, never one per row.
 */
async function loadCustomFieldValuesByContentId(
  workspaceId: string,
  contentIds: string[],
): Promise<Record<string, Record<string, unknown>>> {
  if (contentIds.length === 0) return {};
  const rows = await db
    .select({ id: content.id, customFields: content.customFields })
    .from(content)
    .where(and(eq(content.workspaceId, workspaceId), inArray(content.id, contentIds)))
    .limit(contentIds.length);
  const byId: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    byId[row.id] = (row.customFields ?? {}) as Record<string, unknown>;
  }
  return byId;
}

export const metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

export default async function CalendarPage(
  props: {
    params: Promise<{ ws: string }>;
    searchParams: Promise<{
      m?: string;
      view?: string;
      scope?: string;
      clientId?: string;
      userId?: string;
      group?: string;
      hiddenCols?: string;
      sort?: string;
      dir?: string;
    }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const now = new Date();
  const [year, month] = (searchParams.m ?? "")
    .match(/^(\d{4})-(\d{2})$/)
    ?.slice(1)
    .map(Number) ?? [now.getFullYear(), now.getMonth() + 1];
  const monthIndex = month - 1;
  const view = searchParams.view === "grid" ? "grid" : "month";

  const range = monthGridRange(year, monthIndex);
  const sopFilters = {
    clientId: searchParams.clientId,
    assigneeId: searchParams.userId,
  };
  const [slots, sopSteps, clients] = await Promise.all([
    listScheduledSlots(params.ws, range),
    listScheduledSopSteps(params.ws, range, sopFilters),
    listClients(params.ws),
  ]);

  // Only the grid view pays for these — the month view doesn't render them.
  // resolvedView defaults to "all"/"none" so the fallback below is inert
  // when view !== "grid" (it's never read in that branch).
  let gridRows: Awaited<ReturnType<typeof listPlanGrid>> = [];
  let members: Awaited<ReturnType<typeof listWorkspaceMembers>> = [];
  let resolvedView = resolvePlanView({}, "");
  // F4 — the same field definitions apply to every row on the grid, so this
  // is fetched exactly once here rather than once per row inside the panel.
  let customFieldDefinitions: CustomFieldDefinition[] = [];
  // U7 — the params actually driving this render, after the saved-view
  // fallback below. Defaults to the raw URL so the non-grid branch (which
  // never touches saved views) still has something well-typed to fall back
  // on further down.
  let effectiveViewParams: PlanViewUrlParams = {
    scope: searchParams.scope,
    clientId: searchParams.clientId,
    userId: searchParams.userId,
    group: searchParams.group,
    hiddenCols: searchParams.hiddenCols,
  };
  // D2 — sort isn't part of the saved-view precedence dance (U7 only
  // covers scope/grouping/hiddenCols); it's a plain, always-URL-driven
  // param like `view` or `m`, so it's resolved directly off searchParams.
  const resolvedSort = resolvePlanSort({
    sort: searchParams.sort,
    dir: searchParams.dir,
  });
  if (view === "grid") {
    // requireUser() here is not a second authorization check — the workspace
    // layout already ran requireUser()+requireMembership() before this page
    // ever rendered, and NextAuth v5's auth() is memoized per request, so
    // this doesn't re-hit the session store. It's kept solely to get `user.id`
    // for the saved-view lookup below; there's no prop/context channel from
    // the layout to a page for that value today, and building one is more
    // machinery than this one id is worth.
    const [user, memberRows, definitions] = await Promise.all([
      requireUser(),
      listWorkspaceMembers(params.ws),
      listFieldsForSubject(params.ws, "content"),
    ]);
    members = memberRows;
    customFieldDefinitions = definitions;

    const urlViewParams: PlanViewUrlParams = {
      scope: searchParams.scope,
      clientId: searchParams.clientId,
      userId: searchParams.userId,
      group: searchParams.group,
      hiddenCols: searchParams.hiddenCols,
    };
    // U7 — an explicit URL always wins, so the saved view is only looked up
    // (and only applied) when the visitor arrived with none of the five
    // view params. resolveViewParamsWithSavedView enforces the same rule
    // again on its own, but skipping the read entirely when it can't matter
    // avoids a needless query on every scoped/shared link.
    const savedView = hasAnyPlanViewParam(urlViewParams)
      ? null
      : await getSavedPlanView(params.ws, user.id);
    effectiveViewParams = resolveViewParamsWithSavedView(
      urlViewParams,
      savedView,
    );

    const clientNameById = (id: string) =>
      clients.find((c) => c.id === id)?.name;
    const personNameById = (id: string) =>
      members.find((m) => m.userId === id)?.name ?? undefined;
    resolvedView = resolvePlanView(
      {
        scope: effectiveViewParams.scope,
        clientId: effectiveViewParams.clientId,
        userId: effectiveViewParams.userId,
        group: effectiveViewParams.group,
      },
      user.id,
      clientNameById,
      personNameById,
    );
    gridRows = await listPlanGrid(params.ws, range, {
      ...resolvedView.filter,
      sort: resolvedSort,
    });
  }
  // F5 — which custom-field columns are hidden. Resolved from
  // effectiveViewParams (URL, or the saved view on a bare visit) rather than
  // raw searchParams directly, so a saved view's remembered columns come
  // back the same way its scope and grouping do.
  const hiddenColumnIds = parseHiddenColumnIds(effectiveViewParams.hiddenCols);
  // One batched count query for the whole page, not one per row.
  const gridIds = gridRows.map((r) => r.id);
  const [pending, pendingRevisions, customFieldValuesByContentId] =
    await Promise.all([
      pendingRevisionCounts(params.ws, gridIds),
      pendingRevisionsForContents(params.ws, gridIds),
      loadCustomFieldValuesByContentId(params.ws, gridIds),
    ]);
  const revisionViews = pendingRevisions.map((r) => ({
    id: r.id,
    contentId: r.contentId,
    authorKind: r.authorKind,
    fields: (r.fields ?? {}) as Record<string, unknown>,
    priorFields: (r.priorFields ?? {}) as Record<string, unknown>,
    note: r.note,
    createdAtIso: r.createdAt.toISOString(),
  }));
  const planRows = gridRows.map((r) => ({
    id: r.id,
    scheduledForIso: r.scheduledFor ? r.scheduledFor.toISOString() : null,
    clientName: r.clientName,
    type: r.type as ContentType,
    durationSec: r.durationSec,
    pillar: r.pillar,
    strategyNote: r.strategyNote,
    title: r.title,
    status: r.status,
    complianceStatus: r.complianceStatus,
    productionStage: r.productionStage,
    assigneeId: r.assigneeId,
    dueAtIso: r.dueAt ? r.dueAt.toISOString() : null,
    revisionCount: r.revisionCount,
    pendingSuggestions: pending.get(r.id) ?? 0,
  }));
  const views = slots.map((slot) => ({
    id: slot.id,
    contentId: slot.contentId,
    title: slot.title,
    clientName: slot.clientName,
    clientId: slot.clientId,
    scheduledFor: slot.scheduledFor,
    scheduledForIso: slot.scheduledFor.toISOString(),
    status: slot.status,
    overdue: isOverdueSlot(slot.scheduledFor, slot.status, now),
    checklist: publishChecklist(slot.status),
  }));
  const byDay = groupByDay(views, (v) => v.scheduledFor);

  const milestoneViews = sopSteps.map((step) => ({
    id: step.id,
    runId: step.runId,
    runName: step.runName,
    title: step.title,
    status: step.status,
    dueAt: step.dueAt,
    dueAtIso: step.dueAt.toISOString(),
    gate: step.gate,
    clientName: step.clientName,
  }));
  const milestonesByDay = groupByDay(milestoneViews, (m) => m.dueAt);

  const weeks = monthGrid(year, monthIndex);
  const dayViews: CalendarDayView[][] = weeks.map((week) =>
    week.map((day) => ({
      key: day.key,
      dayOfMonth: day.dayOfMonth,
      inMonth: day.inMonth,
      slots: (byDay.get(day.key) ?? []).map((slot) => ({
        id: slot.id,
        contentId: slot.contentId,
        title: slot.title,
        clientName: slot.clientName,
        clientId: slot.clientId,
        scheduledForIso: slot.scheduledForIso,
        status: slot.status,
        overdue: slot.overdue,
        checklist: slot.checklist,
      })),
      milestones: (milestonesByDay.get(day.key) ?? []).map((m) => ({
        id: m.id,
        runId: m.runId,
        runName: m.runName,
        title: m.title,
        status: m.status,
        dueAtIso: m.dueAtIso,
        gate: m.gate,
        clientName: m.clientName,
      })),
    })),
  );

  const label = new Date(year, monthIndex, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const monthParam = (delta: number) => {
    const d = new Date(year, monthIndex + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  // Shared by ViewControls and PlanGrid below — was mapped twice from the
  // same `members` array.
  const memberOptions = members.map((m) => ({
    id: m.userId,
    label: m.name ?? m.email,
  }));

  return (
    <PageShell width="full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-3xl">Calendar</h1>
          <CalendarLive workspaceId={params.ws} />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href={`/w/${params.ws}/calendar?m=${monthParam(-1)}`}
            className="rounded-md border border-border px-2.5 py-1 text-muted-foreground hover:text-foreground"
          >
            ←
          </Link>
          <span className="min-w-32 text-center text-foreground">{label}</span>
          <Link
            href={`/w/${params.ws}/calendar?m=${monthParam(1)}`}
            className="rounded-md border border-border px-2.5 py-1 text-muted-foreground hover:text-foreground"
          >
            →
          </Link>
        </div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground/70">
        {view === "grid"
          ? "The whole month's plan in one sheet — including posts with no date yet. Workflow state stays read-only; move cards through Approvals and Production."
          : "Scheduled content by publish slot. Reminders go out automatically 24h before each slot."}
      </p>

      <div className="mt-3 flex gap-1 text-sm">
        {(["month", "grid"] as const).map((v) => (
          <Link
            key={v}
            href={`/w/${params.ws}/calendar?m=${monthParam(0)}&view=${v}`}
            aria-current={view === v ? "page" : undefined}
            className={
              view === v
                ? "rounded-md border border-brand-teal/50 bg-brand-teal/10 px-3 py-1 text-foreground"
                : "rounded-md border border-border px-3 py-1 text-muted-foreground hover:text-foreground"
            }
          >
            {v === "month" ? "Month" : "Plan grid"}
          </Link>
        ))}
      </div>

      {view === "grid" ? (
        <>
          <ViewControls
            ws={params.ws}
            monthParam={monthParam(0)}
            scope={resolvedView.scope}
            grouping={resolvedView.grouping}
            clientId={effectiveViewParams.clientId}
            userId={effectiveViewParams.userId}
            clients={clients.map((c) => ({ id: c.id, name: c.name }))}
            members={memberOptions}
            customFields={customFieldDefinitions.map((d) => ({
              id: d.id,
              name: d.name,
            }))}
            hiddenColumnIds={hiddenColumnIds}
            sort={resolvedSort.column}
            dir={resolvedSort.dir}
          />
          <CustomFieldsProvider
            definitions={customFieldDefinitions}
            valuesByContentId={customFieldValuesByContentId}
          >
            <PlanGrid
              workspaceId={params.ws}
              rows={planRows}
              members={memberOptions}
              revisions={revisionViews}
              scope={resolvedView.scope}
              grouping={resolvedView.grouping}
              label={resolvedView.label}
              hiddenColumnIds={hiddenColumnIds}
              monthParam={monthParam(0)}
              clientId={effectiveViewParams.clientId}
              userId={effectiveViewParams.userId}
              sort={resolvedSort}
            />
          </CustomFieldsProvider>
        </>
      ) : (
        <>
          <CalendarBoard
            workspaceId={params.ws}
            weeks={dayViews}
            todayKey={todayKey}
            clients={clients.map((c) => ({ id: c.id, name: c.name }))}
          />

          {slots.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground/70">
              Nothing scheduled yet — approve content in{" "}
              <Link
                href={`/w/${params.ws}/approvals`}
                className="text-brand-teal underline-offset-2 hover:underline"
              >
                Approvals
              </Link>{" "}
              and pick a slot.
            </p>
          ) : null}
        </>
      )}
    </PageShell>
  );
}
