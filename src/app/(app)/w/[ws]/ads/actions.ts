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

/**
 * Pulls a campaign's live numbers from Meta. Writes only numbers Meta
 * reported (C7.0): our campaigns hold no Meta campaign id or ad-account token
 * yet, so today this says so instead of saving anything. The earlier version
 * saved spend and clicks estimated from the budget as if they were real.
 */
export async function syncCampaignMetricsAction(
  workspaceId: string,
  campaignId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);

    const pulled = await pullMetaCampaignMetrics({ metaCampaignId: null, accessToken: null });
    if (pulled.status !== "ok") return { ok: false, error: pulled.reason };

    await updateCampaignMetrics({
      workspaceId,
      campaignId,
      metrics: {
        spend: pulled.metrics.spend,
        impressions: pulled.metrics.impressions,
        clicks: pulled.metrics.clicks,
        conversions: pulled.metrics.conversions,
      },
    });

    revalidatePath(`/w/${workspaceId}/ads`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}
