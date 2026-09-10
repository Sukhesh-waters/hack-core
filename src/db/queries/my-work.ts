import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, content, sopRuns, sopRunSteps, tickets } from "@/db/schema";

const MY_WORK_CAP = 100;

/** Ticket statuses that still need someone. "done" is not work. */
const LIVE_TICKET_STATUSES = ["open", "in_progress", "blocked"] as const;

/** SOP step statuses that represent active/pending work. */
const LIVE_SOP_STATUSES = ["ready", "in_progress", "blocked"] as const;

export type MyWorkItem = {
  kind: "content" | "ticket" | "sop_step";
  id: string;
  title: string;
  clientName: string | null;
  status: string;
  dueAt: Date | null;
  href: string;
  meta?: {
    runId?: string;
    runName?: string;
    gate?: string;
    creates?: string;
    linkedType?: string | null;
    linkedId?: string | null;
    rejectionReason?: string | null;
  };
};

/** Drafts assigned to me that are actually in the production pipeline. */
export function myContentQuery(workspaceId: string, userId: string) {
  return db
    .select({
      id: content.id,
      title: content.title,
      clientName: clients.name,
      productionStage: content.productionStage,
      dueAt: content.dueAt,
    })
    .from(content)
    .innerJoin(clients, eq(clients.id, content.clientId))
    .where(
      and(
        eq(content.workspaceId, workspaceId),
        eq(content.assigneeId, userId),
        // A card with no stage isn't on anyone's board yet.
        isNotNull(content.productionStage),
      ),
    )
    .orderBy(asc(content.dueAt))
    .limit(MY_WORK_CAP);
}

/** Tickets assigned to me that aren't finished. */
export function myTicketsQuery(workspaceId: string, userId: string) {
  return db
    .select({
      id: tickets.id,
      title: tickets.title,
      clientName: clients.name,
      status: tickets.status,
      dueAt: tickets.dueAt,
    })
    .from(tickets)
    .leftJoin(clients, eq(clients.id, tickets.clientId))
    .where(
      and(
        eq(tickets.workspaceId, workspaceId),
        eq(tickets.assigneeId, userId),
        inArray(tickets.status, [...LIVE_TICKET_STATUSES]),
      ),
    )
    .orderBy(asc(tickets.dueAt))
    .limit(MY_WORK_CAP);
}

/** SOP Run steps assigned to me that are currently active in active runs. */
export function mySopStepsQuery(workspaceId: string, userId: string) {
  return db
    .select({
      id: sopRunSteps.id,
      title: sopRunSteps.title,
      status: sopRunSteps.status,
      dueAt: sopRunSteps.dueAt,
      gate: sopRunSteps.gate,
      creates: sopRunSteps.creates,
      linkedType: sopRunSteps.linkedType,
      linkedId: sopRunSteps.linkedId,
      rejectionReason: sopRunSteps.rejectionReason,
      runId: sopRuns.id,
      runName: sopRuns.name,
      clientName: clients.name,
    })
    .from(sopRunSteps)
    .innerJoin(sopRuns, eq(sopRuns.id, sopRunSteps.runId))
    .leftJoin(clients, eq(clients.id, sopRuns.clientId))
    .where(
      and(
        eq(sopRunSteps.workspaceId, workspaceId),
        eq(sopRunSteps.assigneeId, userId),
        inArray(sopRunSteps.status, [...LIVE_SOP_STATUSES]),
        eq(sopRuns.status, "active"),
      ),
    )
    .orderBy(asc(sopRunSteps.dueAt))
    .limit(MY_WORK_CAP);
}

/**
 * Three scoped selects merged in TypeScript: Content Drafts, Tickets, and SOP Run Steps.
 *
 * This provides the unified Work Visibility Spine where all active responsibilities
 * surface in one place for the user.
 */
export async function listMyWork(
  workspaceId: string,
  userId: string,
): Promise<MyWorkItem[]> {
  const [drafts, ticketRows, stepRows] = await Promise.all([
    myContentQuery(workspaceId, userId),
    myTicketsQuery(workspaceId, userId),
    mySopStepsQuery(workspaceId, userId),
  ]);

  const items: MyWorkItem[] = [
    ...drafts.map((d) => ({
      kind: "content" as const,
      id: d.id,
      title: d.title,
      clientName: d.clientName,
      status: d.productionStage ?? "brief",
      dueAt: d.dueAt,
      href: `/w/${workspaceId}/studio/${d.id}`,
    })),
    ...ticketRows.map((t) => ({
      kind: "ticket" as const,
      id: t.id,
      title: t.title,
      clientName: t.clientName,
      status: t.status,
      dueAt: t.dueAt,
      href: `/w/${workspaceId}/tickets/${t.id}`,
    })),
    ...stepRows.map((s) => ({
      kind: "sop_step" as const,
      id: s.id,
      title: s.title,
      clientName: s.clientName,
      status: s.status,
      dueAt: s.dueAt,
      href: `/w/${workspaceId}/sop/runs/${s.runId}`,
      meta: {
        runId: s.runId,
        runName: s.runName,
        gate: s.gate,
        creates: s.creates,
        linkedType: s.linkedType,
        linkedId: s.linkedId,
        rejectionReason: s.rejectionReason,
      },
    })),
  ];

  return sortMyWork(items);
}

/**
 * Soonest deadline first; undated work sorts last rather than pretending to
 * be urgent. Ties break on title so the order is stable across loads.
 *
 * Extracted so the merge ordering is assertable without a database — the
 * source queries are shape-tested separately.
 */
export function sortMyWork(items: MyWorkItem[]): MyWorkItem[] {
  return [...items].sort((a, b) => {
    if (a.dueAt && b.dueAt) {
      const diff = a.dueAt.getTime() - b.dueAt.getTime();
      return diff !== 0 ? diff : a.title.localeCompare(b.title);
    }
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return a.title.localeCompare(b.title);
  });
}
