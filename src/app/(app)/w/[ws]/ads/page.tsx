import Link from "next/link";
import { listCampaigns } from "@/db/queries/campaigns";
import { recentCompetitorAds } from "@/db/queries/ad-intelligence";
import { GlassCard } from "@/components/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CampaignRow } from "./campaign-row";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Ads Management" };
export const dynamic = "force-dynamic";

export default async function AdsPage({
  params,
}: {
  params: { ws: string };
}) {
  const [campaigns, competitorAds] = await Promise.all([
    listCampaigns(params.ws),
    recentCompetitorAds(params.ws, 5),
  ]);

  const totalBudget = campaigns.reduce((sum, c) => sum + c.budget, 0);
  const activeCampaigns = campaigns.filter((c) => c.status === "active");
  const pendingCampaigns = campaigns.filter(
    (c) => c.status === "pending_approval",
  );

  return (
    <PageShell width="wide">
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="label-mono text-brand-teal">Ads Management</p>
          <h1 className="mt-2 font-display text-4xl">
            AI-powered campaign intelligence
          </h1>
          <p className="mt-2 text-sm text-muted-foreground/70">
            Scrape competitor ads, evaluate organic content for ad suitability,
            and launch campaigns through the same approval gate as organic
            content.
          </p>
        </div>
        <Button asChild>
          <Link href={`/w/${params.ws}/ads/new`}>New campaign</Link>
        </Button>
      </div>

      {/* KPI summary cards */}
      <div className="mt-8 grid gap-4 sm:grid-cols-4">
        <GlassCard className="p-5">
          <p className="label-mono text-muted-foreground/70">Campaigns</p>
          <p className="mt-2 font-display text-3xl">{campaigns.length}</p>
        </GlassCard>
        <GlassCard className="p-5">
          <p className="label-mono text-muted-foreground/70">Active</p>
          <p className="mt-2 font-display text-3xl text-brand-teal">
            {activeCampaigns.length}
          </p>
        </GlassCard>
        <GlassCard className="p-5">
          <p className="label-mono text-muted-foreground/70">Pending approval</p>
          <p className="mt-2 font-display text-3xl text-brand-amber">
            {pendingCampaigns.length}
          </p>
        </GlassCard>
        <GlassCard className="p-5">
          <p className="label-mono text-muted-foreground/70">Total budget</p>
          <p className="mt-2 font-display text-3xl">
            ${totalBudget.toLocaleString()}
          </p>
        </GlassCard>
      </div>

      {/* Competitor Ad Intelligence Panel */}
      <GlassCard className="mt-8 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="label-mono text-brand-purple">
              Competitor Ad Intelligence
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Latest ads scraped from public ad libraries — hooks, formats, and
              audience insights
            </p>
          </div>
          <Badge
            variant="outline"
            className="border-brand-purple/40 text-brand-purple"
          >
            {competitorAds.length} ads tracked
          </Badge>
        </div>

        {competitorAds.length > 0 ? (
          <div className="mt-4 space-y-3">
            {competitorAds.map((ad) => (
              <div
                key={ad.id}
                className="rounded-lg border border-border/50 p-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-brand-purple">
                      @{ad.pageHandle}
                    </p>
                    <p className="mt-1 text-sm text-foreground/90 line-clamp-2">
                      {ad.adBody ?? "(no copy available)"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {ad.adFormat ? (
                      <Badge
                        variant="outline"
                        className="border-border text-xs text-muted-foreground/70"
                      >
                        {ad.adFormat}
                      </Badge>
                    ) : null}
                    {ad.targetAudience ? (
                      <Badge
                        variant="outline"
                        className="border-border text-xs text-muted-foreground/70"
                      >
                        {ad.targetAudience}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground/70">
            No competitor ads scraped yet — configure ad library segments in{" "}
            <Link
              href={`/w/${params.ws}/patterns`}
              className="text-brand-teal hover:underline"
            >
              Patterns
            </Link>{" "}
            to start tracking.
          </p>
        )}
      </GlassCard>

      {/* Campaign Table */}
      {campaigns.length === 0 ? (
        <GlassCard className="mt-8 p-8 text-center">
          <p className="font-display text-xl">No campaign briefs yet</p>
          <p className="mt-2 text-sm text-muted-foreground/70">
            Launch one through the AI-powered builder — every campaign routes
            through the same approval gate as organic content.
          </p>
        </GlassCard>
      ) : (
        <GlassCard className="mt-8 overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground/70">
                <th className="p-4 font-normal">Campaign</th>
                <th className="p-4 font-normal">Status</th>
                <th className="p-4 font-normal">Budget</th>
                <th className="p-4 font-normal">Dates</th>
                <th className="p-4 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <CampaignRow
                  key={campaign.id}
                  workspaceId={params.ws}
                  campaign={campaign}
                />
              ))}
            </tbody>
          </table>
        </GlassCard>
      )}
    </div>
    </PageShell>
  );
}
