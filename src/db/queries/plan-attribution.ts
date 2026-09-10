import { and, asc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { clients, content, posts, schedule } from "@/db/schema";
import {
  calculatePlanAttribution,
  type PlanPerformanceRollup,
} from "@/lib/plan/attribution";

export function planAttributionQuery(
  workspaceId: string,
  range?: { from: Date; to: Date },
  clientId?: string,
) {
  return db
    .select({
      slotId: schedule.id,
      contentId: schedule.contentId,
      clientId: schedule.clientId,
      clientName: clients.name,
      title: content.title,
      type: content.type,
      contentStatus: content.status,
      scheduledFor: schedule.scheduledFor,
      postId: posts.id,
      engagementRate: posts.engagementRate,
      reach: posts.reach,
      likes: posts.likes,
      comments: posts.comments,
      score: posts.magnitude,
      postedAt: posts.postedAt,
    })
    .from(schedule)
    .innerJoin(content, eq(content.id, schedule.contentId))
    .innerJoin(clients, eq(clients.id, schedule.clientId))
    .leftJoin(
      posts,
      and(
        eq(posts.workspaceId, workspaceId),
        eq(posts.externalId, content.id),
      ),
    )
    .where(
      and(
        eq(schedule.workspaceId, workspaceId),
        ...(clientId ? [eq(schedule.clientId, clientId)] : []),
        ...(range
          ? [
              gte(schedule.scheduledFor, range.from),
              lt(schedule.scheduledFor, range.to),
            ]
          : []),
      ),
    )
    .orderBy(asc(schedule.scheduledFor));
}

export async function getPlanAttributionReport(
  workspaceId: string,
  range?: { from: Date; to: Date },
  clientId?: string,
): Promise<PlanPerformanceRollup> {
  const rows = await planAttributionQuery(workspaceId, range, clientId);
  const slots = rows.map((r) => ({
    slotKey: r.slotId,
    contentId: r.contentId,
    title: r.title,
    status: r.contentStatus,
    publishedDate:
      r.contentStatus === "published" ? (r.postedAt ?? r.scheduledFor) : null,
    metrics:
      r.engagementRate !== null || r.reach !== null
        ? {
            engagementRate: r.engagementRate ?? undefined,
            reach: r.reach ?? undefined,
            likes: r.likes ?? undefined,
            comments: r.comments ?? undefined,
            score: r.score ?? undefined,
          }
        : undefined,
  }));
  return calculatePlanAttribution(slots);
}
