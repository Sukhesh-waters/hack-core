import { and, count, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { db } from "@/db";
import { content, hubApprovals, ideas, schedule } from "@/db/schema";
import type { OverviewData } from "@/lib/data/types";
import { getWorkspaceSpendSince } from "@/db/queries/usage";
import { aiDailyCapUsd, dayStart } from "@/lib/ai/budget";
import { listClients } from "@/db/queries/clients";
import { driftSignal } from "@/db/queries/drift";
import { computeDrift, DRIFT_WINDOW_N, summarizeDriftAcrossClients } from "@/lib/drift";
import { listTickets } from "@/db/queries/tickets";
import { isOverdueTicket } from "@/lib/tickets";
import { recentFailedAutomationRuns } from "@/db/queries/automations";

const STAGE_LABEL: Record<string, string> = {
  draft: "Brief",
  review: "Internal review",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Published",
};

export function mapOverview(input: {
  slotsThisMonth: number;
  pendingApprovals: number;
  overdueSlots: number;
  newIdeas: number;
  board: { id: string; title: string; status: string }[];
  upcoming: {
    id: string;
    title: string;
    type: string;
    scheduledFor: Date;
    status: string;
  }[];
  spend: OverviewData["spend"];
  drift: OverviewData["drift"];
  tickets: OverviewData["tickets"];
  automations: OverviewData["automations"];
}): OverviewData {
  return {
    stats: [
      {
        label: "Slots this month",
        value: String(input.slotsThisMonth),
        sub: "scheduled publishes",
      },
      {
        label: "Open approvals",
        value: String(input.pendingApprovals),
        sub: "content + hub sign-offs",
      },
      {
        label: "Overdue slots",
        value: String(input.overdueSlots),
        sub: "past due, not published",
      },
      {
        label: "Ideas ready",
        value: String(input.newIdeas),
        sub: "awaiting plan review",
      },
    ],
    productionBoard: input.board.map((row) => ({
      id: row.id,
      title: row.title,
      stage: STAGE_LABEL[row.status] ?? row.status,
    })),
    upcoming: input.upcoming.map((slot) => ({
      id: slot.id,
      title: slot.title,
      platform: slot.type[0].toUpperCase() + slot.type.slice(1),
      day: slot.scheduledFor.getDate(),
      status: STAGE_LABEL[slot.status] ?? slot.status,
    })),
    spend: input.spend,
    drift: input.drift,
    tickets: input.tickets,
    automations: input.automations,
  };
}

export async function liveOverview(workspaceId: string): Promise<OverviewData> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const today = dayStart(now);
  const cap = aiDailyCapUsd();

  const [
    [slots],
    [reviewCount],
    [hubPending],
    [overdue],
    [newIdeas],
    board,
    upcoming,
    todaySpend,
    clientsList,
    allTickets,
    failedRuns,
  ] = await Promise.all([
    db
      .select({ n: count() })
      .from(schedule)
      .where(
        and(
          eq(schedule.workspaceId, workspaceId),
          gte(schedule.scheduledFor, monthStart),
          lt(schedule.scheduledFor, monthEnd),
        ),
      ),
    db
      .select({ n: count() })
      .from(content)
      .where(
        and(eq(content.workspaceId, workspaceId), eq(content.status, "review")),
      ),
    db
      .select({ n: count() })
      .from(hubApprovals)
      .where(
        and(
          eq(hubApprovals.workspaceId, workspaceId),
          eq(hubApprovals.status, "pending"),
        ),
      ),
    db
      .select({ n: count() })
      .from(schedule)
      .innerJoin(content, eq(content.id, schedule.contentId))
      .where(
        and(
          eq(schedule.workspaceId, workspaceId),
          lte(schedule.scheduledFor, now),
          inArray(content.status, ["approved", "scheduled"]),
        ),
      ),
    db
      .select({ n: count() })
      .from(ideas)
      .where(and(eq(ideas.workspaceId, workspaceId), eq(ideas.status, "new"))),
    db
      .select({ id: content.id, title: content.title, status: content.status })
      .from(content)
      .where(
        and(
          eq(content.workspaceId, workspaceId),
          inArray(content.status, ["draft", "review", "approved"]),
        ),
      )
      .limit(5),
    db
      .select({
        id: schedule.id,
        title: content.title,
        type: content.type,
        scheduledFor: schedule.scheduledFor,
        status: content.status,
      })
      .from(schedule)
      .innerJoin(content, eq(content.id, schedule.contentId))
      .where(
        and(
          eq(schedule.workspaceId, workspaceId),
          gte(schedule.scheduledFor, now),
        ),
      )
      .orderBy(schedule.scheduledFor)
      .limit(3),
    getWorkspaceSpendSince(workspaceId, today),
    listClients(workspaceId),
    listTickets(workspaceId),
    recentFailedAutomationRuns(workspaceId, 5),
  ]);

  // Drift: per-client signal, min-N gated by computeDrift (DRIFT_MIN_N) —
  // a client below the floor never contributes a fake magnitude, only counts
  // toward `insufficientCount`. See src/lib/drift.ts for the pure summary.
  const driftPerClient = await Promise.all(
    clientsList.map(async (client) => {
      const signal = await driftSignal(workspaceId, client.id, DRIFT_WINDOW_N);
      return { clientName: client.name, result: computeDrift(signal) };
    }),
  );
  const driftSummary = summarizeDriftAcrossClients(driftPerClient);

  const openTickets = allTickets.filter((t) => t.status !== "done");
  const overdueTickets = openTickets.filter((t) =>
    isOverdueTicket(t.dueAt, t.status, now),
  );

  const capUsed = cap > 0 ? Math.min(100, Math.round((todaySpend.costUsd / cap) * 100)) : 0;

  return mapOverview({
    slotsThisMonth: slots.n,
    pendingApprovals: reviewCount.n + hubPending.n,
    overdueSlots: overdue.n,
    newIdeas: newIdeas.n,
    board,
    upcoming,
    spend: {
      todayUsd: todaySpend.costUsd,
      capUsd: cap,
      percentUsed: capUsed,
      overCap: todaySpend.costUsd >= cap,
    },
    drift: driftSummary,
    tickets: {
      openCount: openTickets.length,
      overdueCount: overdueTickets.length,
    },
    automations: {
      failureCount: failedRuns.length,
      mostRecent: failedRuns[0]
        ? {
            id: failedRuns[0].id,
            ruleName: failedRuns[0].ruleName,
            error: failedRuns[0].error,
            occurredAt: failedRuns[0].finishedAt ?? failedRuns[0].createdAt,
          }
        : null,
    },
  });
}
