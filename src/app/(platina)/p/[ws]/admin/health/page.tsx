import Link from "next/link";
import { PlatinaPage } from "@/components/platina/page";
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

export const dynamic = "force-dynamic";
export const metadata = { title: "Collection health" };

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

function CheckRow({ check }: { check: HealthCheck }) {
  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{check.label}</p>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-medium",
            STATUS_STYLE[check.status],
          )}
        >
          {STATUS_LABEL[check.status]}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{check.detail}</p>
      {check.remedy ? (
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
    searchParams: Promise<{ probe?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const runProbe = searchParams.probe === "1";
  // The provider check makes two short paid AI calls, so it only runs on request.
  const [core, providers] = await Promise.all([
    collectCoreHealth(params.ws),
    runProbe ? probeModelRouter() : Promise.resolve<HealthCheck[]>([]),
  ]);
  const checks = [...core, ...providers];
  const { status, blocking } = summarize(checks);

  return (
    <PlatinaPage
      eyebrow="Platina · Admin"
      title="Collection health"
      description="Is collection running right now, and if not, exactly what to do about it."
    >
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
    </PlatinaPage>
  );
}
