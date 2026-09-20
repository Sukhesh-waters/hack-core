import Link from "next/link";
import { notFound } from "next/navigation";
import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { PendingButton } from "@/components/platina/pending-button";
import { PlanTimeline } from "@/components/platina/plan-timeline";
import { PLAN_VERDICTS } from "@/db/platina-schema";
import { getPlan, getPlanFeedback } from "@/db/queries/platina";
import { recordPlanFeedbackAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaign roadmap" };

const VERDICT_COPY: Record<(typeof PLAN_VERDICTS)[number], string> = {
  worked: "It worked",
  mixed: "Mixed results",
  failed: "It failed",
};

export default async function PlanDetailPage({
  params,
  searchParams,
}: {
  params: { ws: string; planId: string };
  searchParams: { error?: string; saved?: string };
}) {
  const [plan, feedback] = await Promise.all([
    getPlan(params.ws, params.planId),
    getPlanFeedback(params.ws, params.planId),
  ]);
  if (!plan) notFound();

  return (
    <PlatinaPage eyebrow="Campaign roadmap" title={plan.title} description={plan.plan.summary}>
      <PlatinaFormError message={searchParams.error} />

      <p className="mb-4 whitespace-pre-line rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em]">Brief</span>
        {"\n"}
        {plan.brief}
      </p>

      <PlanTimeline plan={plan.plan} />

      <p className="mt-3 text-xs text-muted-foreground">
        {plan.lessonsUsed > 0
          ? `Built using ${plan.lessonsUsed} earlier result${plan.lessonsUsed === 1 ? "" : "s"} you recorded.`
          : "First-pass plan: no earlier results were recorded yet, so it comes from the brief alone."}
      </p>

      {plan.critique.length > 0 ? (
        <section className="mt-6 rounded-md border border-brand-amber/40 bg-brand-amber/5 p-4">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-brand-amber">
            Independent review flagged
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {plan.critique.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-8 rounded-lg border border-border p-5">
        <h2 className="text-sm font-medium">What happened?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Recording the result teaches the next plan. Change it any time.
        </p>
        {searchParams.saved ? (
          <p className="mt-3 text-sm text-brand-success">Saved. The next plan will use this.</p>
        ) : null}
        <form action={recordPlanFeedbackAction} className="mt-4 space-y-4">
          <input type="hidden" name="workspaceId" value={params.ws} />
          <input type="hidden" name="planId" value={plan.id} />
          <fieldset className="flex flex-wrap gap-3">
            <legend className="sr-only">Outcome</legend>
            {PLAN_VERDICTS.map((verdict) => (
              <label
                key={verdict}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent"
              >
                <input
                  type="radio"
                  name="verdict"
                  value={verdict}
                  defaultChecked={feedback?.verdict === verdict}
                  required
                />
                {VERDICT_COPY[verdict]}
              </label>
            ))}
          </fieldset>
          <label className="block text-sm">
            What should we remember? (optional)
            <textarea
              name="note"
              rows={2}
              maxLength={500}
              defaultValue={feedback?.note ?? ""}
              placeholder="e.g. Email converted well; the paid phase burned budget too early."
              className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <PendingButton pendingLabel="Saving...">Save result</PendingButton>
        </form>
      </section>

      <p className="mt-6 text-sm">
        <Link href={`/p/${params.ws}/plan`} className="text-primary hover:underline">
          Back to all plans
        </Link>
      </p>
    </PlatinaPage>
  );
}
