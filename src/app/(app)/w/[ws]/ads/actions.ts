"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/auth";
import { setCampaignStatus, updateCampaignMetrics } from "@/db/queries/campaigns";
import { requireMembership } from "@/db/queries/memberships";
import { actionErrorMessage } from "@/lib/action-errors";
import { pullMetaCampaignMetrics } from "@/lib/connectors/meta-ads";

export type ToggleCampaignState = { error?: string } | undefined;

const toggleSchema = z.object({
  workspaceId: z.string().min(1),
  campaignId: z.string().min(1),
  from: z.enum(["active", "paused"]),
  to: z.enum(["active", "paused"]),
});

export async function toggleCampaignAction(
  _prev: ToggleCampaignState,
  formData: FormData,
): Promise<ToggleCampaignState> {
  const parsed = toggleSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    campaignId: formData.get("campaignId"),
    from: formData.get("from"),
    to: formData.get("to"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, campaignId, from, to } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    await setCampaignStatus({ workspaceId, campaignId, from, to });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/ads`);
  return undefined;
}

export async function syncCampaignMetricsAction(
  workspaceId: string,
  campaignId: string,
  budget: number,
  status: string,
  startDate: Date,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const metrics = await pullMetaCampaignMetrics({
      campaignId,
      budget,
      status,
      startDate,
    });

    await updateCampaignMetrics({
      workspaceId,
      campaignId,
      metrics: {
        spend: metrics.spend,
        impressions: metrics.impressions,
        clicks: metrics.clicks,
        conversions: metrics.conversions,
      },
    });

    revalidatePath(`/w/${workspaceId}/ads`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}
