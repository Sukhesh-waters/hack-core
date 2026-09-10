import Link from "next/link";
import { countPatternPosts, listPatternPosts } from "@/db/queries/accounts";
import { listClients } from "@/db/queries/clients";
import {
  getHarnessRule,
  listPatternRuns,
  listRecentProfileSnapshots,
  listTopPatternPosts,
} from "@/db/queries/harness";
import { getKbStats, listPosts } from "@/db/queries/posts";
import { listInsights } from "@/db/queries/insights";
import { profileDeltas } from "@/lib/pattern-deltas";
import { MIN_BASELINE_N } from "@/lib/scoring";
import { GlassCard } from "@/components/glass-card";
import { ScoreChip } from "@/components/score-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HarnessForm } from "./harness-form";
import { InsightBrief } from "./insight-brief";
import { LiveUrlIngester } from "@/components/kb/live-url-ingester";
import { PageShell } from "@/components/page-shell";

export const metadata = { title: "Knowledge Base" };
export const dynamic = "force-dynamic";

const RUN_STATUS_STYLE: Record<string, string> = {
  done: "border-brand-teal/40 text-brand-teal",
  failed: "border-destructive/40 text-destructive",
  running: "border-brand-amber/40 text-brand-amber",
  queued: "border-border text-muted-foreground/70",
};

function formatPercent(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export default async function KnowledgeBasePage({
  params,
}: {
  params: { ws: string };
}) {
  const [
    stats,
    rows,
    patternCount,
    patternRows,
    rule,
    runs,
    topPosts,
    profileSnapshots,
    pastInsights,
    clientsList,
  ] = await Promise.all([
    getKbStats(params.ws),
    listPosts(params.ws, { limit: 50 }),
    countPatternPosts(params.ws),
    listPatternPosts(params.ws, { limit: 10 }),
    getHarnessRule(params.ws),
    listPatternRuns(params.ws, 15),
    listTopPatternPosts(params.ws, 12),
    listRecentProfileSnapshots(params.ws),
    listInsights(params.ws),
    listClients(params.ws),
  ]);

  // Pattern layer only — never fed into scoring/ideation/reports.
  const deltas = profileDeltas(profileSnapshots);

  const statCards = [
    { label: "Posts ingested", value: String(stats.total) },
    {
      label: "First-party baseline",
      value: `${stats.baselineSize} / ${MIN_BASELINE_N}`,
    },
    { label: "Scored rows", value: String(stats.scored) },
    {
      label: "Median engagement",
      value: formatPercent(stats.medianEngagement),
    },
  ];

  return (
    <PageShell width="wide">
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="label-mono text-brand-teal">Knowledge Base</p>
          <h1 className="mt-2 font-display text-4xl">
            What this account has learned
          </h1>
        </div>
      </div>

      <div className="mt-6">
        <LiveUrlIngester workspaceId={params.ws} clients={clientsList} />
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <GlassCard className="p-5">
          <p className="label-mono text-muted-foreground/70">Add data</p>
          <p className="mt-2 text-sm text-foreground">Import CSV</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Add-on: backfill post history from an export. Optional — declared
            Brand DNA already powers ideation.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link href={`/w/${params.ws}/clients`}>Pick a client →</Link>
          </Button>
        </GlassCard>
        <GlassCard className="p-5">
          <p className="label-mono text-muted-foreground/70">Add data</p>
          <p className="mt-2 text-sm text-foreground">Connect account</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            First-party pulls via Meta — keeps the baseline fresh
            automatically.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link href={`/w/${params.ws}/accounts`}>Connected accounts →</Link>
          </Button>
        </GlassCard>
        <GlassCard className="p-5">
          <p className="label-mono text-muted-foreground/70">Add data</p>
          <p className="mt-2 text-sm text-foreground">Pattern scan</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Apify-scraped public inspiration — pattern layer only, never the
            baseline.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link href="#scraper-ops">Configure scan ↓</Link>
          </Button>
        </GlassCard>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCards.map((card) => (
          <GlassCard key={card.label} className="p-5">
            <p className="label-mono text-muted-foreground/70">{card.label}</p>
            <p className="mt-2 font-display text-3xl">{card.value}</p>
          </GlassCard>
        ))}
      </div>

      <GlassCard className="mt-6 p-6">
        <p className="label-mono text-brand-purple">Two layers, never mixed</p>
        <p className="mt-2 text-sm text-muted-foreground">
          <span className="font-semibold">First-party layer</span> — this
          account&apos;s own consented history. It is the only data the
          baseline and every score below draw from.{" "}
          <span className="font-semibold">Public pattern layer</span> — market
          patterns from public pages (arriving with connectors). Kept in a
          separate namespace, weighted neutral, and never cited as performance
          truth.
        </p>
      </GlassCard>

      <GlassCard className="mt-6 overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground/70">
              <th className="p-4 font-normal">Post</th>
              <th className="p-4 font-normal">Posted</th>
              <th className="p-4 font-normal">Reach</th>
              <th className="p-4 font-normal">Engagement</th>
              <th className="p-4 font-normal">Layer</th>
              <th className="p-4 font-normal">Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground/70">
                  Your baseline builds as data arrives — declared Brand DNA
                  already powers ideation. Add data above whenever you want
                  sharper scores.
                </td>
              </tr>
            ) : (
              rows.map((post) => (
                <tr key={post.id} className="border-b border-border">
                  <td className="max-w-xs truncate p-4 text-foreground">
                    {post.caption ?? (
                      <span className="text-muted-foreground/50">No caption</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap p-4 text-muted-foreground/70">
                    {post.postedAt.toISOString().slice(0, 10)}
                  </td>
                  <td className="p-4 font-mono text-muted-foreground">
                    {post.reach ?? "—"}
                  </td>
                  <td className="p-4 font-mono text-muted-foreground">
                    {formatPercent(post.engagementRate)}
                  </td>
                  <td className="p-4">
                    {/* This table reads the first-party posts table only
                        (baseline layer) — never pattern/public rows. */}
                    <Badge
                      variant="outline"
                      className="border-border text-muted-foreground/70"
                    >
                      First-party
                    </Badge>
                  </td>
                  <td className="p-4">
                    <ScoreChip
                      status={post.scoreStatus}
                      direction={post.direction}
                      magnitude={post.magnitude}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </GlassCard>

      <GlassCard className="mt-6 p-6">
        <div className="flex items-center justify-between">
          <p className="label-mono text-brand-purple">
            Public pattern layer · {patternCount} rows
          </p>
          <Link
            href={`/w/${params.ws}/accounts`}
            className="text-xs text-muted-foreground/70 hover:text-foreground"
          >
            Manage sources →
          </Link>
        </div>
        {patternRows.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground/70">
            Empty — add a public page from Connected Accounts. Pattern rows
            are market context only: neutral weight, no scores, never cited
            as performance truth.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {patternRows.map((pattern) => (
              <li
                key={pattern.id}
                className="flex items-center justify-between text-sm"
              >
                <span className="max-w-md truncate text-muted-foreground">
                  <span className="font-mono text-xs text-muted-foreground/70">
                    @{pattern.pageHandle}
                  </span>{" "}
                  {pattern.caption ?? "No caption"}
                </span>
                <Badge
                  variant="outline"
                  className="border-brand-purple/40 text-brand-purple"
                >
                  Pattern · neutral
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      <div id="scraper-ops" className="mt-10 scroll-mt-8">
        <p className="label-mono text-brand-purple">
          Scraper ops · configure the pattern-layer harness
        </p>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground/70">
          Segmented Apify scans of public pages, hashtags and niches. Results
          live in the pattern layer — neutral weight, never mixed with your
          first-party baseline, never cited as performance truth.
        </p>
      </div>

      <div className="mt-6">
        <HarnessForm
          workspaceId={params.ws}
          initial={{
            segments: rule?.segments ?? [],
            maxPostsPerRun: rule?.maxPostsPerRun ?? 30,
            cadence: rule?.cadence ?? "manual",
            enabled: rule?.enabled ?? false,
          }}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <GlassCard className="p-6">
          <p className="label-mono text-muted-foreground/70">Run history</p>
          {runs.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground/70">
              No runs yet — add segments and hit Run now.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="max-w-[16rem] truncate text-muted-foreground">
                    {run.segment.kind.replace(/_/g, " ")} ·{" "}
                    {run.segment.value}
                    {run.actor ? (
                      <span className="ml-1.5 font-mono text-xs text-muted-foreground/50">
                        {/* A5 observability: which Apify actor ran (slug is
                            owner~name — show just the name) */}
                        {run.actor.split("~").pop()}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        RUN_STATUS_STYLE[run.status] ??
                        "border-border text-muted-foreground/70"
                      }
                    >
                      {run.status}
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground/70">
                      {run.status === "failed"
                        ? (run.error ?? "failed").slice(0, 40)
                        : `${run.postsFetched} posts`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>

        <InsightBrief workspaceId={params.ws} />
      </div>

      <GlassCard className="mt-6 p-6">
        <div className="flex items-center justify-between">
          <p className="label-mono text-muted-foreground/70">Past insights</p>
          <Badge
            variant="outline"
            className="border-brand-purple/40 text-brand-purple"
          >
            PATTERN LAYER · INSPIRATION ONLY
          </Badge>
        </div>
        {pastInsights.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground/70">
            No insights yet. Run an inspiration brief to generate and keep
            them.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {pastInsights.map((insight) => (
              <li
                key={insight.id}
                className="rounded-lg border border-border p-4"
              >
                <p className="text-sm text-foreground">{insight.pattern}</p>
                <p className="mt-1 text-sm text-muted-foreground/70">
                  {insight.suggestion}
                </p>
                <p className="mt-2 font-mono text-xs text-muted-foreground/50">
                  {insight.evidencePatternIds.length} evidence post
                  {insight.evidencePatternIds.length === 1 ? "" : "s"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      {deltas.length > 0 ? (
        <GlassCard className="mt-6 p-6">
          <p className="label-mono text-muted-foreground/70">Tracked profiles</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Public snapshots via harness — pattern layer, not baseline.
          </p>
          <ul className="mt-3 space-y-2">
            {deltas.map((delta) => (
              <li
                key={delta.handle}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="font-mono text-muted-foreground">
                  @{delta.handle}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-mono text-muted-foreground">
                    {delta.followers.toLocaleString()}
                  </span>
                  {"single" in delta ? (
                    <span className="text-muted-foreground/70">
                      first snapshot — deltas next pull
                    </span>
                  ) : (
                    <>
                      <span
                        className={
                          delta.followerDelta >= 0
                            ? "text-brand-teal"
                            : "text-brand-amber"
                        }
                      >
                        {delta.followerDelta >= 0 ? "↑" : "↓"}{" "}
                        {delta.followerDelta >= 0 ? "+" : "−"}
                        {Math.abs(delta.followerDelta).toLocaleString()}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground/70">
                        since {delta.since.toISOString().slice(0, 10)}
                      </span>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </GlassCard>
      ) : null}

      <GlassCard className="mt-6 p-6">
        <div className="flex items-center justify-between">
          <p className="label-mono text-muted-foreground/70">Top performers</p>
          <Badge
            variant="outline"
            className="border-brand-purple/40 text-brand-purple"
          >
            PATTERN LAYER · INSPIRATION ONLY
          </Badge>
        </div>
        {topPosts.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground/70">
            Nothing scanned yet. Configure segments above — competitor
            handles, hashtags, or niche queries — and run a scan.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {topPosts.map((post) => (
              <div
                key={post.id}
                className="rounded-lg border border-border p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs text-muted-foreground/70">
                    @{post.pageHandle}
                  </span>
                  {post.segment ? (
                    <Badge
                      variant="outline"
                      className="shrink-0 border-border text-muted-foreground/70"
                    >
                      {post.segment.split(":")[0].replace(/_/g, " ")}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                  {post.caption ?? "No caption"}
                </p>
                <p className="mt-2 font-mono text-xs text-muted-foreground/70">
                  {post.likes ?? 0} likes · {post.comments ?? 0} comments
                  {post.format ? ` · ${post.format}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
    </PageShell>
  );
}
