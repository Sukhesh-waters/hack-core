"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  toggleCampaignAction,
  type ToggleCampaignState,
} from "./actions";

const STATUS_STYLE: Record<string, string> = {
  active: "border-brand-teal/40 text-brand-teal",
  paused: "border-border text-muted-foreground/70",
  pending_approval: "border-brand-amber/40 text-brand-amber",
  rejected: "border-destructive/40 text-destructive",
  draft: "border-border text-muted-foreground/70",
};

function ToggleButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? "…" : label}
    </Button>
  );
}

export type CampaignRowView = {
  id: string;
  clientName: string;
  name: string;
  objective: string;
  status: "draft" | "pending_approval" | "active" | "paused" | "rejected";
  budget: number;
  startDate: Date;
  endDate: Date | null;
  spend?: number;
  impressions?: number;
  clicks?: number;
  conversions?: number;
  audience: {
    demographics?: string;
    interests?: string[];
    locations?: string[];
  };
  creativeContentId: string | null;
  creativeContentTitle: string | null;
  creativeNote: string | null;
};

function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function CampaignRow({
  workspaceId,
  campaign,
}: {
  workspaceId: string;
  campaign: CampaignRowView;
}) {
  const [state, formAction] = useFormState<ToggleCampaignState, FormData>(
    toggleCampaignAction,
    undefined,
  );
  const canToggle =
    campaign.status === "active" || campaign.status === "paused";
  const toggleTo = campaign.status === "active" ? "paused" : "active";

  const { demographics, interests, locations } = campaign.audience;
  const hasDetail = Boolean(
    demographics ||
      interests?.length ||
      locations?.length ||
      campaign.creativeNote ||
      campaign.creativeContentId ||
      campaign.impressions !== undefined,
  );

  return (
    <>
    <tr className={hasDetail ? "" : "border-b border-border"}>
      <td className="p-4">
        <p className="text-sm text-foreground">{campaign.name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground/70">
          {campaign.clientName} · {campaign.objective}
        </p>
      </td>
      <td className="p-4">
        <Badge
          variant="outline"
          className={STATUS_STYLE[campaign.status] ?? "border-border text-muted-foreground/70"}
        >
          {campaign.status.replace(/_/g, " ")}
        </Badge>
      </td>
      <td className="p-4 font-mono text-sm text-muted-foreground">
        <div>${campaign.budget.toLocaleString()}</div>
        {campaign.spend !== undefined && campaign.spend > 0 ? (
          <div className="text-[11px] text-brand-teal">
            Spent: ${campaign.spend.toLocaleString()}
          </div>
        ) : null}
      </td>
      <td className="p-4 font-mono text-sm text-muted-foreground">
        {formatDate(campaign.startDate)}
        {campaign.endDate ? ` – ${formatDate(campaign.endDate)}` : ""}
      </td>
      <td className="p-4">
        {canToggle ? (
          <form action={formAction}>
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="campaignId" value={campaign.id} />
            <input type="hidden" name="from" value={campaign.status} />
            <input type="hidden" name="to" value={toggleTo} />
            <ToggleButton
              label={campaign.status === "active" ? "Pause" : "Resume"}
            />
            {state?.error ? (
              <p className="mt-1 text-xs text-destructive">{state.error}</p>
            ) : null}
          </form>
        ) : null}
      </td>
    </tr>
    {hasDetail ? (
      <tr className="border-b border-border">
        <td colSpan={5} className="px-4 pb-4">
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer text-muted-foreground/70 hover:text-muted-foreground">
              Targeting &amp; creative
            </summary>
            <div className="mt-2 space-y-1.5">
              {demographics ? (
                <p>
                  <span className="text-muted-foreground/70">Demographics: </span>
                  {demographics}
                </p>
              ) : null}
              {interests?.length ? (
                <p>
                  <span className="text-muted-foreground/70">Interests: </span>
                  {interests.join(", ")}
                </p>
              ) : null}
              {locations?.length ? (
                <p>
                  <span className="text-muted-foreground/70">Locations: </span>
                  {locations.join(", ")}
                </p>
              ) : null}
              {campaign.creativeContentId ? (
                <p>
                  <span className="text-muted-foreground/70">Linked creative: </span>
                  {campaign.creativeContentTitle ? (
                    <Link
                      href={`/w/${workspaceId}/studio/${campaign.creativeContentId}`}
                      className="text-brand-teal hover:underline"
                    >
                      {campaign.creativeContentTitle}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground/70">
                      linked creative unavailable
                    </span>
                  )}
                </p>
              ) : null}
              {campaign.impressions !== undefined && campaign.impressions > 0 ? (
                <div className="rounded-md border border-border bg-background/50 p-2.5 my-2">
                  <p className="font-mono text-[10px] text-brand-teal uppercase font-semibold">
                    Live Meta Performance Metrics
                  </p>
                  <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground/70">Impressions: </span>
                      <span className="font-mono font-medium text-foreground">{campaign.impressions.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground/70">Clicks: </span>
                      <span className="font-mono font-medium text-foreground">{campaign.clicks?.toLocaleString() ?? 0}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground/70">CTR: </span>
                      <span className="font-mono font-medium text-foreground">
                        {campaign.impressions > 0 ? (((campaign.clicks ?? 0) / campaign.impressions) * 100).toFixed(2) : "0"}%
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground/70">Conversions: </span>
                      <span className="font-mono font-medium text-foreground">{campaign.conversions?.toLocaleString() ?? 0}</span>
                    </div>
                  </div>
                </div>
              ) : null}
              {campaign.creativeNote ? (
                <p>
                  <span className="text-muted-foreground/70">Creative note: </span>
                  {campaign.creativeNote}
                </p>
              ) : null}
            </div>
          </details>
        </td>
      </tr>
    ) : null}
    </>
  );
}
