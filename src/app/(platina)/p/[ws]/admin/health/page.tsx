import Link from "next/link";
import { AutoRefresh } from "@/components/platina/auto-refresh";
import { BrainQualityCard } from "@/components/platina/brain-quality-card";
import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { PendingButton } from "@/components/platina/pending-button";
import { latestOpsChecks, opsHistoryQuery } from "@/db/queries/platina-ops";
import { cn } from "@/lib/utils";
import {
  summarize,
  type HealthCheck,
  type ProbeStatus,
} from "@/lib/platina/health";
import {
  collectCoreHealth,
  probeModelRouter,
} from "@/lib/platina/health-collect";
import { loadBrainQualityCard } from "@/lib/platina/brain-quality-loader";
import { ago, dailyStrip, type OpsStatus } from "@/lib/platina/ops-view";
import { runOpsChecksNowAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operations health" };

const STATUS_LABEL: Record<ProbeStatus, string> = {
  ok: "Working",
  degraded: "Degraded",
  down: "Down",
  not_configured: "Not set up",
};

const STATUS_STYLE: Record<ProbeStatus, string> = {
  ok: "bg-brand-success/15 text-brand-success",
  degraded: "bg-brand-amber/15 text-brand-amber",
  down: "bg-destructive/15 text-destructive",
  not_configured: "bg-muted text-muted-foreground",
};

const DOT_STYLE: Record<OpsStatus, string> = {
  ok: "bg-brand-success",
  degraded: "bg-brand-amber",
  down: "bg-destructive",
  not_configured: "bg-muted-foreground/40",
};

const asStatus = (s: string): ProbeStatus =>
  s === "ok" || s === "degraded" || s === "down" || s === "not_configured" ? s : "degraded";

function CheckRow({
  check,
  strip,
}: {
  check: HealthCheck;
  /** Worst status per day for the last 7 days (ops board rows only). */
  strip?: (OpsStatus | null)[];
}) {
  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{check.label}</p>
        <div className="flex items-center gap-3">
          {strip ? (
            <span className="flex gap-1" aria-label="Last 7 days, oldest first">
              {strip.map((day, i) => (
                <span
                  key={i}
                  title={day ? STATUS_LABEL[day] : "no check that day"}
                  className={cn("h-2.5 w-2.5 rounded-sm", day ? DOT_STYLE[day] : "border border-border")}
                />
              ))}
            </span>
          ) : null}
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-medium",
              STATUS_STYLE[check.status],
            )}
          >
            {STATUS_LABEL[check.status]}
          </span>
        </div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{check.detail}</p>
      {check.remedy && check.status !== "ok" ? (
        <p className="mt-2 text-sm">
          <span className="font-medium">Next step: </span>
          {check.remedy}
        </p>
      ) : null}
    </li>
  );
}

export default async function HealthPage(
  props: {
    params: Promise<{ ws: string }>;
    searchParams: Promise<{ probe?: string; running?: string; error?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const runProbe = searchParams.probe === "1";
  const now = new Date();
  // The provider check makes two short paid AI calls, so it only runs on request.
  const [core, providers, ops, history, brainQuality] = await Promise.all([
    collectCoreHealth(params.ws),
    runProbe ? probeModelRouter() : Promise.resolve<HealthCheck[]>([]),
    latestOpsChecks(params.ws),
    opsHistoryQuery(params.ws, new Date(now.getTime() - 7 * 86_400_000)),
    loadBrainQualityCard(params.ws, now),
  ]);
  const checks = [...core, ...providers];
  const { status, blocking } = summarize(checks);
  const strips = dailyStrip(history, now);
  const lastRun = ops[0]?.checkedAt ?? null;
  const red = ops.filter((c) => c.status === "down").length;
  const amber = ops.filter((c) => c.status === "degraded").length;
  // "Run checks now" was pressed: refresh until a run newer than the press lands.
  const waiting = searchParams.running === "1" && (!lastRun || now.getTime() - lastRun.getTime() > 60_000);

  return (
    <PlatinaPage
      eyebrow="Platina · Admin"
      title="Operations health"
      description="Every flow checked on its own every hour: what is working, what needs someone, and exactly what to do."
    >
      <PlatinaFormError message={searchParams.error} />
      <AutoRefresh active={waiting} intervalMs={5_000} maxMs={120_000} />

      <section aria-label="Ops board">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-medium">Ops board</h2>
          <form action={runOpsChecksNowAction}>
            <input type="hidden" name="workspaceId" value={params.ws} />
            <PendingButton pendingLabel="Queuing…">Run checks now</PendingButton>
          </form>
        </div>
        {ops.length === 0 ? (
          <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            {waiting
              ? "Running the checks…"
              : "No checks have run yet. They run every hour once the job runner is up, or press Run checks now."}
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm">
              {red > 0
                ? `${red} flow${red === 1 ? " is" : "s are"} red: the first step for each is below.`
                : amber > 0
                  ? `Nothing is red; ${amber} flow${amber === 1 ? " needs" : "s need"} attention.`
                  : "Every flow is green."}{" "}
              <span className="text-muted-foreground">
                Last checked {lastRun ? ago(lastRun, now) : "never"}
                {waiting ? " · running now…" : ""}.
              </span>
            </p>
            <ul className="space-y-3">
              {ops.map((c) => (
                <CheckRow
                  key={c.id}
                  strip={strips.get(c.checkId)}
                  check={{
                    id: c.checkId,
                    label: c.label,
                    status: asStatus(c.status),
                    detail: c.detail,
                    remedy: c.remedy ?? undefined,
                    required: false,
                  }}
                />
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-label="Collection right now" className="mt-10">
        <h2 className="mb-3 font-display text-lg font-medium">Collection right now</h2>
        <p className="mb-4 text-sm">
          {blocking.length > 0
            ? `Collection is blocked by ${blocking.length} problem(s) below.`
            : status === "ok"
              ? "Everything checked is working."
              : "Collection can run, but something is degraded."}
        </p>
        <ul className="space-y-3">
          {checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </ul>
        <div className="mt-6">
          {runProbe ? (
            <Link
              href={`/p/${params.ws}/admin/health`}
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Hide provider check
            </Link>
          ) : (
            <Link
              href={`/p/${params.ws}/admin/health?probe=1`}
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Run the AI provider check (two short AI calls)
            </Link>
          )}
        </div>
      </section>

      <BrainQualityCard rows={brainQuality} />
    </PlatinaPage>
  );
}
