import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import { recordActivity } from "@/lib/activity";
import {
  clients,
  content,
  schedule,
  sopRuns,
  sopRunSteps,
  users,
  type ContentTypeValue,
} from "@/db/schema";
import type { ResolvedPlanSort } from "@/lib/plan-view";

// Hard caps so no screen ever pulls an unbounded table (small-agency
// scale: ~5 clients, <1k posts per workspace — revisit if that changes).
const APPROVAL_QUEUE_CAP = 100;
const SLOTS_CAP = 500;
const REMINDER_SWEEP_CAP = 500;

/** Content awaiting a human decision: compliance-passed review + approved. */
export function approvalQueueQuery(workspaceId: string) {
  return db
    .select({
      id: content.id,
      clientId: content.clientId,
      clientName: clients.name,
      title: content.title,
      type: content.type,
      status: content.status,
      complianceStatus: content.complianceStatus,
      complianceReport: content.complianceReport,
      createdAt: content.createdAt,
    })
    .from(content)
    .innerJoin(clients, eq(clients.id, content.clientId))
    .where(
      and(
        eq(content.workspaceId, workspaceId),
        inArray(content.status, ["review", "approved"]),
      ),
    )
    .orderBy(asc(content.createdAt))
    .limit(APPROVAL_QUEUE_CAP);
}

/** Scheduled slots with their content, for the calendar grid. Pass the
 *  visible grid's [from, to) so month views never fetch full history. */
export function scheduledSlotsQuery(
  workspaceId: string,
  range?: { from: Date; to: Date },
) {
  return db
    .select({
      id: schedule.id,
      contentId: schedule.contentId,
      clientId: schedule.clientId,
      clientName: clients.name,
      title: content.title,
      type: content.type,
      status: content.status,
      scheduledFor: schedule.scheduledFor,
      reminderSentAt: schedule.reminderSentAt,
    })
    .from(schedule)
    .innerJoin(content, eq(content.id, schedule.contentId))
    .innerJoin(clients, eq(clients.id, schedule.clientId))
    .where(
      and(
        eq(schedule.workspaceId, workspaceId),
        ...(range
          ? [
              gte(schedule.scheduledFor, range.from),
              lt(schedule.scheduledFor, range.to),
            ]
          : []),
      ),
    )
    .orderBy(asc(schedule.scheduledFor))
    .limit(SLOTS_CAP);
}

/** Active SOP Run steps with deadlines within the calendar range. */
export function scheduledSopStepsQuery(
  workspaceId: string,
  range?: { from: Date; to: Date },
  filters?: { clientId?: string; assigneeId?: string },
) {
  return db
    .select({
      id: sopRunSteps.id,
      runId: sopRunSteps.runId,
      runName: sopRuns.name,
      title: sopRunSteps.title,
      status: sopRunSteps.status,
      dueAt: sopRunSteps.dueAt,
      gate: sopRunSteps.gate,
      clientName: clients.name,
      assigneeId: sopRunSteps.assigneeId,
    })
    .from(sopRunSteps)
    .innerJoin(sopRuns, eq(sopRuns.id, sopRunSteps.runId))
    .leftJoin(clients, eq(clients.id, sopRuns.clientId))
    .where(
      and(
        eq(sopRunSteps.workspaceId, workspaceId),
        eq(sopRuns.status, "active"),
        inArray(sopRunSteps.status, ["ready", "in_progress", "blocked"]),
        ...(filters?.clientId ? [eq(sopRuns.clientId, filters.clientId)] : []),
        ...(filters?.assigneeId
          ? [eq(sopRunSteps.assigneeId, filters.assigneeId)]
          : []),
        ...(range
          ? [
              gte(sopRunSteps.dueAt, range.from),
              lt(sopRunSteps.dueAt, range.to),
            ]
          : []),
      ),
    )
    .orderBy(asc(sopRunSteps.dueAt))
    .limit(SLOTS_CAP);
}

export function listScheduledSopSteps(
  workspaceId: string,
  range?: { from: Date; to: Date },
  filters?: { clientId?: string; assigneeId?: string },
) {
  return scheduledSopStepsQuery(workspaceId, range, filters);
}

/**
 * System sweep for the Inngest reminder cron: slots due within the horizon
 * whose reminder hasn't been sent. Rows carry workspace_id so the sender
 * resolves recipients per workspace — never across them.
 */
export function dueRemindersQuery(dueBefore: Date) {
  return db
    .select({
      id: schedule.id,
      workspaceId: schedule.workspaceId,
      clientId: schedule.clientId,
      contentId: schedule.contentId,
      scheduledFor: schedule.scheduledFor,
      title: content.title,
      // S10: the reminder goes to whoever owns the work, not the whole
      // workspace. Null falls back to the team.
      assigneeId: content.assigneeId,
    })
    .from(schedule)
    .innerJoin(content, eq(content.id, schedule.contentId))
    .where(
      and(
        lte(schedule.scheduledFor, dueBefore),
        isNull(schedule.reminderSentAt),
      ),
    )
    .orderBy(asc(schedule.scheduledFor))
    .limit(REMINDER_SWEEP_CAP);
}

export async function listApprovalQueue(workspaceId: string) {
  return approvalQueueQuery(workspaceId);
}

export async function listScheduledSlots(
  workspaceId: string,
  range?: { from: Date; to: Date },
) {
  return scheduledSlotsQuery(workspaceId, range);
}

// S2 plan grid. Default 200 rows, hard cap 500 — a month of planning for a
// small agency is tens of rows; anything past the cap means the range is
// wrong, not that the grid should page.
const PLAN_GRID_DEFAULT = 200;
const PLAN_GRID_CAP = 500;

/**
 * The plan grid reads content-first, unlike scheduledSlotsQuery which reads
 * schedule-first. That inversion is the whole point: a planned post that has
 * no date yet is exactly the row a planner needs to see and fix, so schedule
 * is a LEFT JOIN and undated rows survive the range filter.
 *
 * Users is also LEFT JOINed so unassigned rows appear; clients stays INNER
 * because content.clientId is NOT NULL and a missing client is corruption,
 * not an empty cell.
 */
/**
 * D2 — turns a whitelisted `ResolvedPlanSort` into `orderBy` clauses. The
 * column comes from `plan-view.ts`'s closed union type, never a raw
 * string, so there is no path from a URL value to SQL text here — this
 * function cannot be called with anything but one of the six known
 * columns without a type error. Every branch keeps `content.createdAt`
 * as a stable secondary sort (matching the original fixed order) and
 * nulls-last for nullable columns, so undated/unassigned/unpillared rows
 * stay at the bottom regardless of direction — that was the whole point
 * of the original fixed sort and D2 doesn't get to break it.
 */
function planGridOrderBy(sort: ResolvedPlanSort) {
  const dir = sort.dir === "desc" ? sql`desc` : sql`asc`;
  switch (sort.column) {
    case "date":
      return [sql`${schedule.scheduledFor} ${dir} nulls last`, asc(content.createdAt)];
    case "client":
      return [
        sort.dir === "desc" ? desc(clients.name) : asc(clients.name),
        asc(content.createdAt),
      ];
    case "status":
      return [
        sort.dir === "desc" ? desc(content.status) : asc(content.status),
        asc(content.createdAt),
      ];
    case "pillar":
      return [sql`${content.pillar} ${dir} nulls last`, asc(content.createdAt)];
    case "assignee":
      return [sql`${users.name} ${dir} nulls last`, asc(content.createdAt)];
    case "title":
      return [
        sort.dir === "desc" ? desc(content.title) : asc(content.title),
        asc(content.createdAt),
      ];
  }
}

export function planGridQuery(
  workspaceId: string,
  range: { from: Date; to: Date },
  opts?: {
    clientId?: string;
    /** U2 — narrow to one person's work. */
    assigneeId?: string;
    /** U2 — rows nobody owns yet; the gap a planner is looking for. */
    unassignedOnly?: boolean;
    limit?: number;
    /** D2 — defaults to the original fixed date/asc order. */
    sort?: ResolvedPlanSort;
  },
) {
  const limit = Math.min(opts?.limit ?? PLAN_GRID_DEFAULT, PLAN_GRID_CAP);
  return db
    .select({
      id: content.id,
      scheduledFor: schedule.scheduledFor,
      clientId: content.clientId,
      clientName: clients.name,
      type: content.type,
      durationSec: content.durationSec,
      pillar: content.pillar,
      strategyNote: content.strategyNote,
      title: content.title,
      status: content.status,
      complianceStatus: content.complianceStatus,
      productionStage: content.productionStage,
      assigneeId: content.assigneeId,
      assigneeName: users.name,
      dueAt: content.dueAt,
      revisionCount: content.revisionCount,
      createdAt: content.createdAt,
    })
    .from(content)
    .innerJoin(clients, eq(clients.id, content.clientId))
    .leftJoin(schedule, eq(schedule.contentId, content.id))
    .leftJoin(users, eq(users.id, content.assigneeId))
    .where(
      and(
        eq(content.workspaceId, workspaceId),
        // Date-bound the scheduled rows, but never filter out the undated
        // ones — they have no date to compare and are the point of the view.
        or(
          isNull(schedule.scheduledFor),
          and(
            gte(schedule.scheduledFor, range.from),
            lt(schedule.scheduledFor, range.to),
          ),
        ),
        ...(opts?.clientId ? [eq(content.clientId, opts.clientId)] : []),
        ...(opts?.assigneeId
          ? [eq(content.assigneeId, opts.assigneeId)]
          : []),
        ...(opts?.unassignedOnly ? [isNull(content.assigneeId)] : []),
      ),
    )
    .orderBy(...planGridOrderBy(opts?.sort ?? { column: "date", dir: "asc" }))
    .limit(limit);
}

/** The content-side columns a grid cell may write. status, complianceStatus
 *  and productionStage are deliberately absent — see updatePlanCellAction. */
export type PlanCellValues = Partial<{
  type: ContentTypeValue;
  durationSec: number | null;
  pillar: string | null;
  strategyNote: string | null;
  title: string;
  assigneeId: string | null;
  dueAt: Date | null;
}>;

export function updatePlanCellQuery(input: {
  workspaceId: string;
  contentId: string;
  values: PlanCellValues;
}) {
  return db
    .update(content)
    .set(input.values)
    .where(
      and(
        eq(content.workspaceId, input.workspaceId),
        eq(content.id, input.contentId),
      ),
    )
    .returning({ id: content.id });
}

/**
 * Setting a plan row's publish slot. scheduledFor lives on `schedule`, not
 * `content`, so this either moves an existing row, creates one, or clears it.
 *
 * Reuses createScheduledPost's one-post-per-client-per-minute guard — the
 * grid is a second way to collide on a slot, and the guard previously
 * existed only on the quick-add path.
 */
export async function setPlanSlot(input: {
  workspaceId: string;
  contentId: string;
  clientId: string;
  scheduledFor: Date | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { workspaceId, contentId, clientId, scheduledFor } = input;
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: schedule.id })
      .from(schedule)
      .where(
        and(
          eq(schedule.workspaceId, workspaceId),
          eq(schedule.contentId, contentId),
        ),
      )
      .limit(1);

    if (scheduledFor === null) {
      if (existing.length > 0) {
        await tx
          .delete(schedule)
          .where(
            and(
              eq(schedule.workspaceId, workspaceId),
              eq(schedule.contentId, contentId),
            ),
          );
      }
      return { ok: true as const };
    }

    const clash = await tx
      .select({ id: schedule.id })
      .from(schedule)
      .where(
        and(
          eq(schedule.workspaceId, workspaceId),
          eq(schedule.clientId, clientId),
          eq(schedule.scheduledFor, scheduledFor),
        ),
      )
      .limit(1);
    if (clash.length > 0 && clash[0].id !== existing[0]?.id) {
      return {
        ok: false as const,
        error: "That slot already has a post for this client.",
      };
    }

    if (existing.length > 0) {
      await tx
        .update(schedule)
        .set({ scheduledFor })
        .where(
          and(
            eq(schedule.workspaceId, workspaceId),
            eq(schedule.contentId, contentId),
          ),
        );
    } else {
      await tx
        .insert(schedule)
        .values({ workspaceId, clientId, contentId, scheduledFor });
    }
    return { ok: true as const };
  });
}

export async function listPlanGrid(
  workspaceId: string,
  range: { from: Date; to: Date },
  opts?: {
    clientId?: string;
    assigneeId?: string;
    unassignedOnly?: boolean;
    limit?: number;
    sort?: ResolvedPlanSort;
  },
) {
  return planGridQuery(workspaceId, range, opts);
}

/** Direct calendar add — content and its slot born together, atomically.
 *  Lands at status "draft" (production stage "brief"), same as a normal
 *  production-board card: picking a day is a target date, not an approval.
 *  Content still must pass compliance/approvals (complianceStatus==="passed"
 *  via scheduleContent) before it can ever reach "scheduled" — this used to
 *  write status:"scheduled" directly with empty body, bypassing that gate
 *  entirely. The schedule row is still created up front so the target date
 *  shows on the calendar immediately; the UI marks it as pending. */
export async function createScheduledPost(input: {
  workspaceId: string;
  clientId: string;
  title: string;
  type: ContentTypeValue;
  scheduledFor: Date;
}): Promise<string> {
  const { scheduledFor, ...contentInput } = input;
  return db.transaction(async (tx) => {
    // Guard against two posts landing on the exact same slot for one client —
    // the calendar quick-add has no other collision check.
    const clash = await tx
      .select({ id: schedule.id })
      .from(schedule)
      .where(
        and(
          eq(schedule.workspaceId, input.workspaceId),
          eq(schedule.clientId, input.clientId),
          eq(schedule.scheduledFor, scheduledFor),
        ),
      )
      .limit(1);
    if (clash.length > 0) {
      throw new Error("That slot already has a post for this client.");
    }
    const [row] = await tx
      .insert(content)
      .values({
        ...contentInput,
        body: "",
        status: "draft",
        productionStage: "brief",
      })
      .returning({ id: content.id });
    await tx.insert(schedule).values({
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      contentId: row.id,
      scheduledFor,
    });
    return row.id;
  });
}

/** approved → scheduled: one slot per content, status flips atomically. */
export async function scheduleContent(input: {
  workspaceId: string;
  clientId: string;
  contentId: string;
  scheduledFor: Date;
  actorId?: string | null;
}) {
  const { actorId, ...row } = input;
  await db.transaction(async (tx) => {
    await tx.insert(schedule).values(row);
    await tx
      .update(content)
      .set({ status: "scheduled" })
      .where(
        and(
          eq(content.workspaceId, input.workspaceId),
          eq(content.id, input.contentId),
        ),
      );
  });
  await recordActivity({
    workspaceId: input.workspaceId,
    subjectType: "content",
    subjectId: input.contentId,
    actorId: actorId ?? null,
    verb: "scheduled",
    meta: { scheduledFor: input.scheduledFor.toISOString() },
  });
}

export async function markReminderSent(scheduleId: string, sentAt: Date) {
  await db
    .update(schedule)
    .set({ reminderSentAt: sentAt })
    .where(eq(schedule.id, scheduleId));
}
