import Link from "next/link";
import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { PendingButton } from "@/components/platina/pending-button";
import { listPlansWithVerdict } from "@/db/queries/platina";
import { BRIEF_MAX_CHARS } from "@/lib/platina/plan/brief";
import { cn } from "@/lib/utils";
import { createPlanAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plan a campaign" };

const VERDICT_LABEL: Record<string, { label: string; classes: string }> = {
  worked: { label: "Worked", classes: "border-brand-success/40 text-brand-success" },
  mixed: { label: "Mixed", classes: "border-brand-amber/40 text-brand-amber" },
  failed: { label: "Failed", classes: "border-destructive/40 text-destructive" },
};

export default async function PlanPage({
  params,
  searchParams,
}: {
  params: { ws: string };
  searchParams: { error?: string };
}) {
  const plans = await listPlansWithVerdict(params.ws);

  return (
    <PlatinaPage
      eyebrow="Campaign planning"
      title="Plan a campaign"
      description="Two lines: what you are promoting and who it is for. You get a phased roadmap, and the plans you mark as worked or failed shape the next one."
    >
      <PlatinaFormError message={searchParams.error} />

      <form action={createPlanAction} className="space-y-3">
        <input type="hidden" name="workspaceId" value={params.ws} />
        <label className="block text-sm font-medium">
          Your brief
          <textarea
            name="brief"
            rows={2}
            required
            maxLength={BRIEF_MAX_CHARS}
            placeholder={"Launch our new espresso subscription.\nTarget: home baristas in the UK, 25-40."}
            className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          />
        </label>
        <PendingButton pendingLabel="Planning...">Plan this campaign</PendingButton>
      </form>

      <section className="mt-10">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Your plans
        </h2>
        {plans.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No plans yet. Write a brief above to make the first one.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
            {plans.map((plan) => {
              const verdict = plan.verdict ? VERDICT_LABEL[plan.verdict] : null;
              return (
                <li key={plan.id}>
                  <Link
                    href={`/p/${params.ws}/plan/${plan.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {plan.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {plan.brief.replace(/\s+/g, " ")}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2.5 py-0.5 text-xs",
                        verdict ? verdict.classes : "border-border text-muted-foreground",
                      )}
                    >
                      {verdict ? verdict.label : "No result yet"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PlatinaPage>
  );
}
