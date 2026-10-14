import Link from "next/link";
import { notFound } from "next/navigation";
import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { PendingButton } from "@/components/platina/pending-button";
import { PlanTimeline } from "@/components/platina/plan-timeline";
import { PLAN_VERDICTS } from "@/db/platina-schema";
import { getPlan, getPlanFeedback, listPlanRevisions } from "@/db/queries/platina";
import { listCreativesForPlan } from "@/db/queries/platina-learning";
import { isStale } from "@/lib/platina/plan/evidence";
import { describePlanFalsifier } from "@/lib/platina/plan/falsifier";
import { freshnessMessage, refutedMessage, verdictLabel } from "@/lib/platina/plan/freshness";
import { readPlanFreshness } from "@/lib/platina/plan/freshness-read";
import { cn } from "@/lib/utils";
import { recordPlanFeedbackAction, revisePlanAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaign roadmap" };

const VERDICT_COPY: Record<(typeof PLAN_VERDICTS)[number], string> = {
  worked: "It worked",
  mixed: "Mixed results",
  failed: "It failed",
};

const UNGROUNDED_REASON: Record<string, string> = {
  none_relevant:
    "We have collected market signals, but none matched this brief closely enough to rest a plan on.",
  empty_brain: "Nothing has been collected and validated yet, so there was no market evidence to use.",
  no_client_evidence:
    "Nothing has been collected for this client and its competitors yet, so there was no evidence to use.",
};

export default async function PlanDetailPage(
  props: {
    params: Promise<{ ws: string; planId: string }>;
    searchParams: Promise<{ error?: string; saved?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const [plan, feedback] = await Promise.all([
    getPlan(params.ws, params.planId),
    getPlanFeedback(params.ws, params.planId),
  ]);
  if (!plan) notFound();
  const [fresh, revisions, creatives] = await Promise.all([
    readPlanFreshness({
      workspaceId: params.ws,
      brandId: plan.brandId,
      createdAt: plan.createdAt,
      evidenceIds: (plan.plan.evidence ?? []).map((e) => e.id),
    }),
    listPlanRevisions(params.ws, plan.id),
    listCreativesForPlan(params.ws, plan.id),
  ]);
  const doc = plan.plan;
  const verdictById = new Map(fresh.verdicts.map((v) => [v.id, v]));
  const refutedCount = fresh.verdicts.filter((v) => v.verdict === "refuted").length;
  const counterEvidence = (doc.evidence ?? []).filter((e) => e.role === "counter");

  return (
    <PlatinaPage eyebrow="Campaign roadmap" title={plan.title} description={doc.summary}>
      <PlatinaFormError message={searchParams.error} />

      <p className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {plan.origin ? (
          <span className="rounded-full border border-border px-2.5 py-0.5">{plan.origin.label}</span>
        ) : null}
        {plan.parentPlanId ? (
          <Link
            href={`/p/${params.ws}/plan/${plan.parentPlanId}`}
            className="underline underline-offset-4"
          >
            See the plan this revises
          </Link>
        ) : null}
        {revisions[0] ? (
          <Link
            href={`/p/${params.ws}/plan/${revisions[0].id}`}
            className="font-medium text-brand-amber underline underline-offset-4"
          >
            A newer version exists
          </Link>
        ) : null}
      </p>

      {doc.revisionNote ? (
        <p className="mb-4 whitespace-pre-line rounded-md border border-border bg-card px-4 py-3 text-sm">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            What changed
          </span>
          {"\n"}
          {doc.revisionNote}
        </p>
      ) : null}

      <p className="mb-4 whitespace-pre-line rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em]">Brief</span>
        {"\n"}
        {plan.brief}
      </p>

      <section
        aria-label="New evidence since this plan"
        className={cn(
          "mb-6 rounded-lg border p-4",
          fresh.level === "replan"
            ? "border-brand-amber/40 bg-brand-amber/5"
            : "border-border bg-card",
        )}
      >
        {refutedCount > 0 ? (
          <p className="mb-2 text-sm font-medium text-brand-amber">{refutedMessage(refutedCount)}</p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">{freshnessMessage(fresh.count, fresh.scopeLabel)}</p>
          <form action={revisePlanAction}>
            <input type="hidden" name="workspaceId" value={params.ws} />
            <input type="hidden" name="planId" value={plan.id} />
            <PendingButton pendingLabel="Re-planning…">
              {refutedCount > 0 || fresh.count > 0 ? "Re-plan with the new evidence" : "Re-plan now"}
            </PendingButton>
          </form>
        </div>
        {fresh.sample.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {fresh.sample.map((e) => (
              <li key={e.id} className="text-xs">
                <span className="block">{e.content}</span>
                <span className="text-muted-foreground">
                  {e.sourceUrl ? (
                    <a href={e.sourceUrl} className="underline underline-offset-2" rel="noreferrer" target="_blank">
                      Source
                    </a>
                  ) : (
                    "Source unavailable"
                  )}
                  {` · collected ${e.collectedAt.toISOString().slice(0, 10)}`}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Counts validated signals from this {fresh.scopeLabel ? "client's sources" : "workspace"}, not how
          much each matters to this plan. Re-planning keeps this version and its recorded result.
        </p>
      </section>

      <PlanTimeline plan={doc} />

      {doc.falsifier ? (
        <p className="mt-3 rounded-md border border-border bg-card px-4 py-3 text-sm">
          <span className="block font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            How we&apos;ll know if this plan is wrong
          </span>
          {describePlanFalsifier(doc.falsifier)}
        </p>
      ) : null}

      <section aria-label="Creatives and results" className="mt-6 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">What was posted, and what it taught</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Log each piece you post against its phase. Its confirmed review traces back to the evidence the phase cited.
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          {doc.phases.map((phase) => {
            const posted = creatives.filter((c) => c.phaseId === phase.id);
            const logHref = `/p/${params.ws}/results/new?${new URLSearchParams({
              plan: plan.id,
              phase: phase.id,
              ...(plan.brandId ? { brand: plan.brandId } : {}),
            })}`;
            return (
              <li key={phase.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <span className="font-medium">{phase.name}</span>
                  <span className="text-muted-foreground"> · {phase.channel}</span>
                  {posted.length > 0 ? (
                    <span className="block text-xs">
                      {posted.map((c, i) => (
                        <span key={c.id}>
                          {i > 0 ? ", " : ""}
                          <Link href={`/p/${params.ws}/results/${c.id}`} className="text-primary underline-offset-4 hover:underline">
                            {c.title}
                          </Link>
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
                <Link href={logHref} className="text-xs text-primary underline-offset-4 hover:underline">
                  Log a creative
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="mt-3 text-xs text-muted-foreground">
        {plan.lessonsUsed > 0
          ? `Built using ${plan.lessonsUsed} earlier result${plan.lessonsUsed === 1 ? "" : "s"} you recorded.`
          : "First-pass plan: no earlier results were recorded yet, so it comes from the brief alone."}
      </p>
      {doc.coldStart ? (
        <p className="mt-2 rounded-md border border-brand-amber/40 bg-brand-amber/5 px-3 py-2 text-xs">
          Cold start: no collected market evidence and no recorded results informed this plan.{" "}
          {UNGROUNDED_REASON[doc.evidenceStatus ?? ""] ?? "It is built from the brief alone."}
        </p>
      ) : null}

      {(doc.evidence?.length ?? 0) > 0 ? (
        <section className="mt-6" aria-label="Evidence">
          <h2 className="text-sm font-medium">Evidence behind each phase</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Public market signals collected for this workspace, and the client&apos;s own data (its website and confirmed
            results), each phase citing one kind only. Older evidence is marked, not hidden.
          </p>
          <ul className="mt-3 space-y-3">
            {doc.phases.map((phase) => {
              const cited = (phase.evidenceIds ?? [])
                .map((id) => doc.evidence?.find((e) => e.id === id))
                .filter((e): e is NonNullable<typeof e> => Boolean(e));
              return (
                <li key={phase.id} className="rounded-md border border-border bg-card p-3">
                  <p className="text-sm font-medium">{phase.name}</p>
                  {cited.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">No evidence cited for this phase.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {cited.map((e) => {
                        const verdict = verdictById.get(e.id);
                        return (
                        <li key={e.id} className="text-xs">
                          {verdict ? (
                            <span
                              className={cn(
                                "mb-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium",
                                verdict.verdict === "refuted"
                                  ? "bg-brand-amber/15 text-brand-amber"
                                  : "bg-brand-success/15 text-brand-success",
                              )}
                            >
                              {verdictLabel(verdict)}
                            </span>
                          ) : null}
                          <span className="block">
                            {e.plane === "A" ? <span className="mr-1 rounded border border-primary/40 px-1 text-primary">own data</span> : null}
                            {e.role === "counter" ? <span className="mr-1 rounded border border-brand-amber/40 px-1 text-brand-amber">counter-evidence</span> : null}
                            {e.content}
                          </span>
                          <span className="text-muted-foreground">
                            {e.sourceUrl ? (
                              <a href={e.sourceUrl} className="underline underline-offset-2" rel="noreferrer" target="_blank">
                                Source
                              </a>
                            ) : (
                              "Source unavailable"
                            )}
                            {" · "}
                            {e.collectedAt ? `collected ${e.collectedAt.slice(0, 10)}` : "collection date unknown"}
                            {isStale(e.collectedAt, new Date()) ? " · STALE" : ""}
                          </span>
                        </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {counterEvidence.length > 0 ? (
        <section className="mt-6 rounded-md border border-brand-amber/40 bg-brand-amber/5 p-4" aria-label="Counter-evidence">
          <h2 className="text-sm font-medium">Counter-evidence the planner weighed</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The strongest point against the plan&apos;s main assumption: an opposite reading on the same subject, or
            one that was proved wrong before. Shown so the plan is not built only on what agrees with it.
          </p>
          <ul className="mt-2 space-y-2">
            {counterEvidence.map((e) => (
              <li key={e.id} className="text-xs">
                <span className="block">{e.content}</span>
                <span className="text-muted-foreground">
                  {e.sourceUrl ? (
                    <a href={e.sourceUrl} className="underline underline-offset-2" rel="noreferrer" target="_blank">
                      Source
                    </a>
                  ) : (
                    "Source unavailable"
                  )}
                  {" · "}
                  {e.collectedAt ? `collected ${e.collectedAt.slice(0, 10)}` : "collection date unknown"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
