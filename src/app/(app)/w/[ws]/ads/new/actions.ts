"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { createCampaign } from "@/db/queries/campaigns";
import { createHubApproval } from "@/db/queries/hub";
import { requireMembership } from "@/db/queries/memberships";
import { actionErrorMessage } from "@/lib/action-errors";
import { campaignSchema } from "@/lib/validation";

export type CreateCampaignState = { error?: string } | undefined;

export async function createCampaignWithApproval(
  _prev: CreateCampaignState,
  formData: FormData,
): Promise<CreateCampaignState> {
  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { error: "Malformed campaign payload — reload and try again." };
  }
  const parsed = campaignSchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const data = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(data.workspaceId, user.id);

    const campaignId = await createCampaign({
      workspaceId: data.workspaceId,
      clientId: data.clientId,
      name: data.name,
      objective: data.objective,
      audience: {
        demographics: data.audience.demographics,
        interests: data.audience.interests,
        locations: data.audience.locations,
      },
      budget: data.budget,
      startDate: new Date(data.startDate),
      endDate: data.endDate ? new Date(data.endDate) : null,
      creativeContentId: data.creativeContentId ?? null,
      creativeNote: data.creativeNote ?? null,
      createdById: user.id,
    });

    await createHubApproval({
      workspaceId: data.workspaceId,
      requestedById: user.id,
      title: `Campaign launch: ${data.name} ($${data.budget})`,
      campaignId,
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  redirect(`/w/${data.workspaceId}/ads`);
}
