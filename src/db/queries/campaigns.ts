import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  campaigns,
  clients,
  content,
  type CampaignAudience,
} from "@/db/schema";

export type CampaignsQueryOpts = {
  /** F9.5: filter to one client's campaigns, for the client detail page —
   *  same opts pattern as ticketsQuery. Workspace-scoped as always. */
  clientId?: string;
};

export function campaignsQuery(
  workspaceId: string,
  opts: CampaignsQueryOpts = {},
) {
  return db
    .select({
      id: campaigns.id,
      clientId: campaigns.clientId,
      clientName: clients.name,
      name: campaigns.name,
      objective: campaigns.objective,
      status: campaigns.status,
      budget: campaigns.budget,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      audience: campaigns.audience,
      creativeContentId: campaigns.creativeContentId,
      // F9.4: resolved title for the linked creative, via a LEFT JOIN so
      // campaigns without a linked creative (or whose linked content was
      // deleted) still appear — title comes back null in both cases, which
      // campaign-row.tsx treats as "linked creative unavailable" when an id
      // is still set. The join ON clause (not just campaigns.workspaceId in
      // WHERE) also pins content.workspaceId = workspaceId: creativeContentId's
      // FK only guarantees content.id exists, not that it's in this
      // workspace, so without this the join could otherwise resolve a title
      // belonging to a different workspace's content row.
      creativeContentTitle: content.title,
      creativeNote: campaigns.creativeNote,
      spend: campaigns.spend,
      impressions: campaigns.impressions,
      clicks: campaigns.clicks,
      conversions: campaigns.conversions,
      createdAt: campaigns.createdAt,
    })
    .from(campaigns)
    .innerJoin(clients, eq(clients.id, campaigns.clientId))
    .leftJoin(
      content,
      and(
        eq(content.id, campaigns.creativeContentId),
        eq(content.workspaceId, workspaceId),
      ),
    )
    .where(
      and(
        eq(campaigns.workspaceId, workspaceId),
        opts.clientId ? eq(campaigns.clientId, opts.clientId) : undefined,
      ),
    )
    .orderBy(desc(campaigns.createdAt))
    .limit(100);
}

export async function listCampaigns(workspaceId: string) {
  return campaignsQuery(workspaceId);
}

/** F9.5: a client's campaigns for the client detail page. Thin wrapper over
 *  campaignsQuery's new clientId opt — kept as a named export so the page's
 *  Promise.all reads clearly, matching the listContentForClient precedent. */
export async function campaignsForClient(workspaceId: string, clientId: string) {
  return campaignsQuery(workspaceId, { clientId });
}

/** Builder exposed for .toSQL() assertions. Workspace-scoped single-row
 *  lookup — added for F9.3's ticket-link resolution (campaigns previously
 *  only had a list query, no get-by-id). */
export function getCampaignByIdQuery(workspaceId: string, campaignId: string) {
  return db
    .select({
      id: campaigns.id,
      clientId: campaigns.clientId,
      clientName: clients.name,
      name: campaigns.name,
    })
    .from(campaigns)
    .innerJoin(clients, eq(clients.id, campaigns.clientId))
    .where(
      and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.id, campaignId)),
    )
    .limit(1);
}

export async function getCampaignById(workspaceId: string, campaignId: string) {
  const rows = await getCampaignByIdQuery(workspaceId, campaignId);
  return rows[0] ?? null;
}

export async function createCampaign(input: {
  workspaceId: string;
  clientId: string;
  name: string;
  objective: "awareness" | "traffic" | "engagement" | "leads" | "conversions";
  audience: CampaignAudience;
  budget: number;
  startDate: Date;
  endDate: Date | null;
  creativeContentId: string | null;
  creativeNote: string | null;
  createdById: string;
}): Promise<string> {
  const [row] = await db
    .insert(campaigns)
    .values({ ...input, status: "pending_approval" })
    .returning({ id: campaigns.id });
  return row.id;
}

/** Pause/resume toggle — guarded from/to, never touches pending_approval,
 *  draft, or rejected rows. */
export async function setCampaignStatus(input: {
  workspaceId: string;
  campaignId: string;
  from: "active" | "paused";
  to: "active" | "paused";
}) {
  await db
    .update(campaigns)
    .set({ status: input.to })
    .where(
      and(
        eq(campaigns.workspaceId, input.workspaceId),
        eq(campaigns.id, input.campaignId),
        eq(campaigns.status, input.from),
      ),
    );
}

export async function updateCampaignMetrics(input: {
  workspaceId: string;
  campaignId: string;
  metrics: {
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
  };
}) {
  await db
    .update(campaigns)
    .set({
      spend: input.metrics.spend,
      impressions: input.metrics.impressions,
      clicks: input.metrics.clicks,
      conversions: input.metrics.conversions,
    })
    .where(
      and(
        eq(campaigns.workspaceId, input.workspaceId),
        eq(campaigns.id, input.campaignId),
      ),
    );
}
