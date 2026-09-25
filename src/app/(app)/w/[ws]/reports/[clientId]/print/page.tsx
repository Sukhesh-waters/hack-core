import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import { getClientById } from "@/db/queries/clients";
import {
  countNextMonthScheduled,
  listClientPerformance,
  listFormatPerformance,
} from "@/db/queries/analytics";
import { topMoversQuery } from "@/db/queries/posts";
import { nextMonthRange } from "@/lib/reports";
import { MIN_BASELINE_N } from "@/lib/scoring";
import { Badge } from "@/components/ui/badge";
import { PrintButton } from "./print-button";

export const metadata = { title: "Client Performance Digest" };
export const dynamic = "force-dynamic";

function pct(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export default async function PrintReportPage(
  props: {
    params: Promise<{ ws: string; clientId: string }>;
  }
) {
  const params = await props.params;
  const user = await requireUser();
  await requireMembership(params.ws, user.id);

  const client = await getClientById(params.ws, params.clientId);
  if (!client) notFound();

  const rollup = await listClientPerformance(params.ws);
  const clientPerf = rollup.find((c) => c.clientId === params.clientId);

  const now = new Date();
  const { start, end } = nextMonthRange(now);
  const monthLabel = start.toLocaleDateString("en-US", { month: "long" });

  const [up, down, formats, nextMonthScheduled] = await Promise.all([
    topMoversQuery(params.ws, params.clientId, "up", 5),
    topMoversQuery(params.ws, params.clientId, "down", 5),
    listFormatPerformance(params.ws, params.clientId),
    countNextMonthScheduled(params.ws, params.clientId, start, end),
  ]);

  const posts = clientPerf?.posts ?? 0;
  const scored = clientPerf?.scored ?? 0;
  const avgEngagement = clientPerf?.avgEngagement ?? null;
  const insufficient = posts < MIN_BASELINE_N;

  return (
    <div className="min-h-screen bg-background text-foreground p-6 sm:p-12 print:p-0 print:bg-background print:text-black">
      {/* Action Bar (hidden when printing) */}
      <div className="mb-8 flex items-center justify-between border-b border-border pb-4 print:hidden">
        <Link
          href={`/w/${params.ws}/reports`}
          className="text-xs text-muted-foreground hover:text-foreground transition"
        >
          ← Back to Reports
        </Link>
        <div className="flex items-center gap-3">
          <a
            href={`/api/w/${params.ws}/reports/${params.clientId}/export`}
            download
            className="text-xs px-3 py-1.5 rounded-md border border-border bg-muted/40 hover:bg-muted text-foreground transition"
          >
            Download CSV
          </a>
          <PrintButton />
        </div>
      </div>

      {/* Printable Report Header */}
      <div className="border-b border-border pb-6 print:border-neutral-300">
        <div className="flex justify-between items-start">
          <div>
            <p className="label-mono text-brand-teal print:text-neutral-700">
              Platina Performance Digest
            </p>
            <h1 className="mt-1 font-display text-3xl font-semibold print:text-2xl print:text-neutral-900">
              {client.name}
            </h1>
            {client.handle ? (
              <p className="font-mono text-xs text-muted-foreground print:text-neutral-600 mt-0.5">
                {client.handle}
              </p>
            ) : null}
          </div>
          <div className="text-right">
            <p className="label-mono text-muted-foreground print:text-neutral-600">
              Report Date
            </p>
            <p className="font-mono text-sm mt-0.5 print:text-neutral-900">
              {now.toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="mt-6 grid grid-cols-3 gap-4 print:gap-3">
        <div className="rounded-lg border border-border p-4 bg-muted/10 print:border-neutral-300 print:bg-neutral-50">
          <p className="label-mono text-muted-foreground print:text-neutral-600">
            Posts Tracked
          </p>
          <p className="mt-1 font-display text-3xl font-bold print:text-2xl">
            {posts}
          </p>
          <p className="mt-1 text-xs text-muted-foreground print:text-neutral-500">
            {scored} scored
          </p>
        </div>
        <div className="rounded-lg border border-border p-4 bg-muted/10 print:border-neutral-300 print:bg-neutral-50">
          <p className="label-mono text-muted-foreground print:text-neutral-600">
            Avg Engagement Rate
          </p>
          <p className="mt-1 font-display text-3xl font-bold print:text-2xl">
            {insufficient ? "—" : pct(avgEngagement)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground print:text-neutral-500">
            first-party baseline
          </p>
        </div>
        <div className="rounded-lg border border-border p-4 bg-muted/10 print:border-neutral-300 print:bg-neutral-50">
          <p className="label-mono text-muted-foreground print:text-neutral-600">
            Sample Baseline
          </p>
          <p className="mt-1 font-display text-3xl font-bold print:text-2xl">
            {posts} / {MIN_BASELINE_N}
          </p>
          <p className="mt-1 text-xs text-muted-foreground print:text-neutral-500">
            {insufficient ? "below threshold" : "cleared"}
          </p>
        </div>
      </div>

      {insufficient ? (
        <div className="mt-6 rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-600 dark:text-amber-400 print:border-neutral-400 print:bg-neutral-100 print:text-neutral-800">
          <p className="font-medium">Insufficient baseline for engagement scoring</p>
          <p className="mt-1">
            Scores appear once this client reaches {MIN_BASELINE_N} first-party
            posts. Platina never fabricates or estimates baseline percentages
            below this threshold.
          </p>
        </div>
      ) : null}

      {/* Format Breakdown */}
      <div className="mt-8">
        <h2 className="label-mono text-muted-foreground print:text-neutral-700">
          Performance by Format
        </h2>
        {formats.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No published posts categorized by format yet.
          </p>
        ) : (
          <table className="mt-3 w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border print:border-neutral-300 text-muted-foreground print:text-neutral-700">
                <th className="py-2 font-medium">Format</th>
                <th className="py-2 font-medium">Post Count</th>
                <th className="py-2 font-medium text-right">Avg Engagement</th>
              </tr>
            </thead>
            <tbody>
              {formats.map((f) => (
                <tr
                  key={f.format ?? "unlabeled"}
                  className="border-b border-border/50 print:border-neutral-200"
                >
                  <td className="py-2 font-medium capitalize">
                    {f.format ?? "Unlabeled"}
                  </td>
                  <td className="py-2">{f.count}</td>
                  <td className="py-2 text-right font-mono">
                    {insufficient ? "—" : pct(f.avgEngagement)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Top Drivers & Underperformers */}
      {!insufficient ? (
        <div className="mt-8 grid sm:grid-cols-2 gap-6 print:grid-cols-2">
          <div>
            <h2 className="label-mono text-brand-teal print:text-neutral-800">
              Top Drivers (Above Baseline)
            </h2>
            <ul className="mt-3 space-y-2">
              {up.length === 0 ? (
                <li className="text-xs text-muted-foreground">None recorded.</li>
              ) : (
                up.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 text-xs border border-border/60 p-2.5 rounded print:border-neutral-300"
                  >
                    <span className="truncate">{p.caption ?? "Untitled post"}</span>
                    <Badge
                      variant="outline"
                      className="shrink-0 border-brand-teal/40 font-mono text-brand-teal print:text-neutral-900"
                    >
                      ↑ {Math.round((p.magnitude ?? 0) * 100)}%
                    </Badge>
                  </li>
                ))
              )}
            </ul>
          </div>
          <div>
            <h2 className="label-mono text-brand-amber print:text-neutral-800">
              Underperformers (Below Baseline)
            </h2>
            <ul className="mt-3 space-y-2">
              {down.length === 0 ? (
                <li className="text-xs text-muted-foreground">None recorded.</li>
              ) : (
                down.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 text-xs border border-border/60 p-2.5 rounded print:border-neutral-300"
                  >
                    <span className="truncate">{p.caption ?? "Untitled post"}</span>
                    <Badge
                      variant="outline"
                      className="shrink-0 border-brand-amber/40 font-mono text-brand-amber print:text-neutral-900"
                    >
                      ↓ {Math.round((p.magnitude ?? 0) * 100)}%
                    </Badge>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}

      {/* Upcoming Month Schedule Preview */}
      <div className="mt-8 rounded-lg border border-border p-4 bg-muted/5 print:border-neutral-300">
        <h2 className="label-mono text-muted-foreground print:text-neutral-700">
          {monthLabel} Content Pipeline
        </h2>
        <p className="mt-1 text-sm print:text-neutral-900">
          <span className="font-semibold font-mono">{nextMonthScheduled}</span> post
          {nextMonthScheduled === 1 ? "" : "s"} currently scheduled in the editorial
          calendar.
        </p>
      </div>

      {/* Printable Footer */}
      <div className="mt-12 pt-4 border-t border-border text-center text-xs text-muted-foreground print:border-neutral-300 print:text-neutral-500">
        <p>Generated by Platina AI OS · Confidential</p>
      </div>
    </div>
  );
}
