import Link from "next/link";
import {
  countNextMonthScheduled,
  getWorkspaceTotals,
  listClientPerformance,
  listEngagementTrend,
  listFormatPerformance,
} from "@/db/queries/analytics";
import { topMoversQuery } from "@/db/queries/posts";
import { listRecentSends } from "@/db/queries/report-sends";
import { getPlanAttributionReport } from "@/db/queries/plan-attribution";
import { MIN_BASELINE_N } from "@/lib/scoring";
import { buildReportDraft, nextMonthRange } from "@/lib/reports";
import { buildTrendSeries } from "@/lib/analytics";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/glass-card";
import { PerformanceAreaChart } from "@/components/charts/performance-chart";
import { ContactEmailForm } from "./contact-email-form";
import { ReportComposer } from "./report-composer";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

function pct(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

/** C3: truncates a post caption for the pre-filled ticket-suggestion title.
 *  Small page-local helper, not exported — same "not unit tested" precedent
 *  as `pct()` above, one line of real logic. */
function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max
    ? `${trimmed.slice(0, max).trimEnd()}…`
    : trimmed;
}

export default async function ReportsPage({
  params,
}: {
  params: { ws: string };
}) {
  // First-party only (two-layer rule) — every query filters
  // source="first_party" at the DB layer. A rolling 12-week window for the
  // trend; the min-N gate is applied on the workspace-wide total, not the
  // window, so a thin recent stretch can't fake a trend.
  const since = new Date(Date.now() - 12 * 7 * 24 * 60 * 60 * 1000);
  const [rollup, totals, trendBuckets, planAttribution] = await Promise.all([
    listClientPerformance(params.ws),
    getWorkspaceTotals(params.ws),
    listEngagementTrend(params.ws, since),
    getPlanAttributionReport(params.ws),
  ]);
  const now = new Date();
  const { start, end } = nextMonthRange(now);
  const monthLabel = start.toLocaleDateString("en-US", { month: "long" });

  const trend = buildTrendSeries(trendBuckets, totals.posts);
  const workspaceInsufficient = totals.posts < MIN_BASELINE_N;

  return (
    <PageShell width="wide">
    <div>
      <div>
        <p className="label-mono text-brand-teal">Reports</p>
        <h1 className="mt-2 font-display text-4xl">What actually performs</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground/70">
          First-party results only. Every published post you record feeds
          back into the baseline and re-weights these drivers.
        </p>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <GlassCard className="p-5">
          <p className="label-mono text-muted-foreground/70">Posts tracked</p>
          <p className="mt-1 font-display text-3xl">{totals.posts}</p>
          <p className="mt-1 text-xs text-muted-foreground/70">{totals.scored} scored</p>
        </GlassCard>
        <GlassCard className="p-5">
          <p className="label-mono text-muted-foreground/70">Avg engagement</p>
          <p className="mt-1 font-display text-3xl">
            {workspaceInsufficient ? "—" : pct(totals.avgEngagement)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground/70">workspace-wide</p>
        </GlassCard>
        <GlassCard className="p-5">
          <p className="label-mono text-muted-foreground/70">Baseline</p>
          <p className="mt-1 font-display text-3xl">
            {totals.posts} / {MIN_BASELINE_N}
          </p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            {workspaceInsufficient ? "below baseline" : "cleared"}
          </p>
        </GlassCard>
      </div>

      <GlassCard className="mt-6 p-6">
        <p className="label-mono text-muted-foreground/70">Engagement trend · 12 weeks</p>
        {trend.status === "insufficient_baseline" ? (
          <p className="mt-3 text-sm text-muted-foreground/70">
            Insufficient baseline — trends appear once this workspace reaches{" "}
            {MIN_BASELINE_N} first-party posts. No line is drawn from a handful
            of points.
          </p>
        ) : trend.points.length < 2 ? (
          <p className="mt-3 text-sm text-muted-foreground/70">
            Not enough scored weeks yet to plot a trend.
          </p>
        ) : (
          <div className="mt-3">
            <PerformanceAreaChart
              data={trend.points.map((p) => ({
                label: new Date(p.bucket).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                }),
                value: Number(((p.avgEngagement ?? 0) * 100).toFixed(2)),
              }))}
              valueSuffix="%"
              color="teal"
            />
          </div>
        )}
      </GlassCard>

      <GlassCard className="mt-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="label-mono text-brand-teal">
              Editorial Plan ↔ Published Loop (W8)
            </p>
            <h2 className="mt-1 font-display text-xl">
              Plan Delivery & Attribution
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground/70">
              Measuring post performance attributed back to the planned editorial slots.
            </p>
          </div>
          <div className="flex items-center gap-6 text-right">
            <div>
              <p className="label-mono text-muted-foreground/70">Planned Slots</p>
              <p className="font-display text-2xl">
                {planAttribution.totalPlanned}
              </p>
            </div>
            <div>
              <p className="label-mono text-muted-foreground/70">Published</p>
              <p className="font-display text-2xl">
                {planAttribution.totalPublished}
              </p>
            </div>
            <div>
              <p className="label-mono text-muted-foreground/70">Fulfillment</p>
              <p className="font-display text-2xl text-brand-teal">
                {planAttribution.totalPlanned > 0
                  ? `${planAttribution.publishRate}%`
                  : "—"}
              </p>
            </div>
          </div>
        </div>
        {planAttribution.topPerformingSlot ? (
          <div className="mt-4 rounded-md border border-brand-teal/30 bg-brand-teal/5 p-3 flex items-center justify-between gap-3 text-xs">
            <div className="min-w-0 flex-1">
              <span className="font-medium text-brand-teal">
                Top Performing Planned Asset:{" "}
              </span>
              <span className="truncate text-foreground font-medium">
                {planAttribution.topPerformingSlot.title}
              </span>
            </div>
            {planAttribution.topPerformingSlot.metrics?.engagementRate !== undefined ? (
              <Badge
                variant="outline"
                className="border-brand-teal/40 font-mono text-brand-teal"
              >
                {pct(planAttribution.topPerformingSlot.metrics.engagementRate)} ER
              </Badge>
            ) : null}
          </div>
        ) : null}
      </GlassCard>

      {rollup.length === 0 ? (
        <GlassCard className="mt-8 p-8 text-center">
          <p className="text-sm text-muted-foreground/70">
            No clients yet — onboard one through the intake wizard.
          </p>
        </GlassCard>
      ) : (
        <div className="mt-8 space-y-6">
          {await Promise.all(
            rollup.map(async (client) => {
              const [up, down, formats, nextMonthScheduled, recentSends] =
                await Promise.all([
                  topMoversQuery(params.ws, client.clientId, "up", 3),
                  topMoversQuery(params.ws, client.clientId, "down", 3),
                  listFormatPerformance(params.ws, client.clientId),
                  countNextMonthScheduled(
                    params.ws,
                    client.clientId,
                    start,
                    end,
                  ),
                  listRecentSends(params.ws, client.clientId),
                ]);
              // Min-N gate (constitution): no score/number shows until the
              // client reaches the baseline sample size — otherwise a client
              // with a couple of posts would flash a real-looking Avg ER right
              // next to the "no numbers are faked below this line" notice.
              const insufficient = client.posts < MIN_BASELINE_N;
              const maxFormatAvg = Math.max(
                0,
                ...formats.map((f) => f.avgEngagement ?? 0),
              );
              const draft = buildReportDraft({
                clientName: client.name,
                posts: client.posts,
                scored: client.scored,
                avgEngagement: client.avgEngagement,
                insufficient,
                formats,
                nextMonthScheduled,
                monthLabel,
              });

              return (
                <GlassCard key={client.clientId} className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-display text-2xl">{client.name}</p>
                      {client.handle ? (
                        <p className="font-mono text-xs text-muted-foreground/70">
                          {client.handle}
                        </p>
                      ) : null}
                      <div className="mt-2">
                        <p className="label-mono text-muted-foreground/70">
                          Contact email
                        </p>
                        <div className="mt-1">
                          <ContactEmailForm
                            workspaceId={params.ws}
                            clientId={client.clientId}
                            contactEmail={client.contactEmail}
                          />
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <a
                          href={`/api/w/${params.ws}/reports/${client.clientId}/export`}
                          download
                          className="inline-flex items-center text-xs px-2.5 py-1 rounded border border-border bg-muted/30 hover:bg-muted text-foreground transition"
                        >
                          Export CSV
                        </a>
                        <Link
                          href={`/w/${params.ws}/reports/${client.clientId}/print`}
                          target="_blank"
                          className="inline-flex items-center text-xs px-2.5 py-1 rounded border border-border bg-muted/30 hover:bg-muted text-foreground transition"
                        >
                          Print Digest ↗
                        </Link>
                      </div>
                    </div>
                    <div className="flex gap-6 text-right">
                      <div>
                        <p className="label-mono text-muted-foreground/70">Posts</p>
                        <p className="mt-1 font-display text-2xl">
                          {client.posts}
                        </p>
                      </div>
                      <div>
                        <p className="label-mono text-muted-foreground/70">Avg ER</p>
                        <p className="mt-1 font-display text-2xl">
                          {insufficient ? "—" : pct(client.avgEngagement)}
                        </p>
                      </div>
                      <div>
                        <p className="label-mono text-muted-foreground/70">Baseline</p>
                        <p className="mt-1 font-display text-2xl">
                          {client.posts} / {MIN_BASELINE_N}
                        </p>
                      </div>
                    </div>
                  </div>

                  {insufficient ? (
                    <p className="mt-4 text-sm text-muted-foreground/70">
                      Insufficient baseline — scores appear once this client
                      reaches {MIN_BASELINE_N} first-party posts. No numbers
                      are faked below that line.
                    </p>
                  ) : (
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      <div>
                        <p className="label-mono text-brand-teal">
                          Top drivers ↑
                        </p>
                        <ul className="mt-2 space-y-1.5">
                          {up.length === 0 ? (
                            <li className="text-sm text-muted-foreground/70">
                              None yet.
                            </li>
                          ) : (
                            up.map((post) => (
                              <li
                                key={post.id}
                                className="flex items-center justify-between gap-2 text-sm"
                              >
                                <span className="truncate text-muted-foreground">
                                  {post.caption ?? "No caption"}
                                </span>
                                <Badge
                                  variant="outline"
                                  className="shrink-0 border-brand-teal/40 font-mono text-brand-teal"
                                >
                                  ↑ {Math.round((post.magnitude ?? 0) * 100)}
                                </Badge>
                              </li>
                            ))
                          )}
                        </ul>
                      </div>
                      <div>
                        <p className="label-mono text-brand-amber">
                          Underperformers ↓
                        </p>
                        <ul className="mt-2 space-y-1.5">
                          {down.length === 0 ? (
                            <li className="text-sm text-muted-foreground/70">
                              None yet.
                            </li>
                          ) : (
                            down.map((post) => {
                              // C3: suggestion link, not an automation — the
                              // user still reviews and submits on /tickets.
                              // Every value here is already on screen: the
                              // magnitude badge below and the client in scope
                              // for this rollup row.
                              //
                              // Deliberately NOT linkedType=content/linkedId
                              // here: `post.id` is a `posts` row (the
                              // analytics/ingestion table this page reads
                              // from), not a `content` row (the Studio
                              // drafting table linkedType="content" actually
                              // validates against) — the two tables have no
                              // shared key anywhere in the schema, so that
                              // link could never resolve and would only
                              // produce a rejected submit. The post is
                              // referenced by caption in the description
                              // text instead, which carries the same context
                              // without a broken structured link.
                              const magnitudePct = Math.round(
                                (post.magnitude ?? 0) * 100,
                              );
                              const captionLabel = post.caption
                                ? truncate(post.caption, 60)
                                : "untitled post";
                              const ticketHref = `/w/${params.ws}/tickets?${new URLSearchParams(
                                {
                                  title: `Investigate underperformance: ${captionLabel}`,
                                  description: `"${captionLabel}" is trending ~${magnitudePct}% below baseline for this client. Flagged from the Reports page.`,
                                  clientId: client.clientId,
                                },
                              ).toString()}`;

                              return (
                                <li
                                  key={post.id}
                                  className="flex items-center justify-between gap-2 text-sm"
                                >
                                  <span className="truncate text-muted-foreground">
                                    {post.caption ?? "No caption"}
                                  </span>
                                  <div className="flex shrink-0 items-center gap-2">
                                    <Badge
                                      variant="outline"
                                      className="border-brand-amber/40 font-mono text-brand-amber"
                                    >
                                      ↓ {magnitudePct}
                                    </Badge>
                                    <Link
                                      href={ticketHref}
                                      className="text-xs text-muted-foreground/70 hover:text-brand-teal hover:underline"
                                    >
                                      Create ticket →
                                    </Link>
                                  </div>
                                </li>
                              );
                            })
                          )}
                        </ul>
                      </div>
                    </div>
                  )}

                  <div className="mt-5">
                    <p className="label-mono text-muted-foreground/70">By format</p>
                    {formats.length === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground/70">
                        No first-party posts yet.
                      </p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {formats.map((f) => (
                          <div key={f.format ?? "unlabeled"}>
                            <div className="flex items-center justify-between text-xs text-muted-foreground/70">
                              <span>{f.format ?? "Unlabeled"}</span>
                              <span className="font-mono">
                                {f.count} · {pct(f.avgEngagement)}
                              </span>
                            </div>
                            <div className="mt-1 h-1.5 rounded-full bg-muted">
                              <div
                                className="h-1.5 rounded-full bg-brand-teal"
                                style={{
                                  width: maxFormatAvg
                                    ? `${Math.max(4, ((f.avgEngagement ?? 0) / maxFormatAvg) * 100)}%`
                                    : "4%",
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <p className="mt-4 text-xs text-muted-foreground/70">
                    {monthLabel} preview: {nextMonthScheduled} post
                    {nextMonthScheduled === 1 ? "" : "s"} already scheduled.
                  </p>

                  <div className="mt-5 border-t border-border pt-4">
                    <p className="label-mono text-muted-foreground/70">
                      Edit & send report
                    </p>
                    <ReportComposer
                      workspaceId={params.ws}
                      clientId={client.clientId}
                      contactEmail={client.contactEmail}
                      initialDraft={draft}
                      recentSends={recentSends}
                    />
                  </div>
                </GlassCard>
              );
            }),
          )}
        </div>
      )}
    </div>
    </PageShell>
  );
}
