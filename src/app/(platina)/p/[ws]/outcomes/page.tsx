import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import {
  firstPartyOutcomesQuery,
  getWorkspaceConfig,
  listOutcomeImports,
  listOutcomes,
  listReceipts,
} from "@/db/queries/platina";
import { minNGate } from "@/lib/platina/retrieval";
import { gradeReceiptAction, importOutcomesAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platina outcomes" };

const VERDICT_LABEL: Record<string, string> = {
  pending: "Awaiting review",
  worked: "Worked",
  did_not_work: "Did not work",
  inconclusive: "Inconclusive",
};

export default async function OutcomesPage({
  params,
  searchParams,
}: {
  params: { ws: string };
  searchParams: { error?: string };
}) {
  const [receipts, outcomes, imports, config, firstParty] = await Promise.all([
    listReceipts(params.ws),
    listOutcomes(params.ws),
    listOutcomeImports(params.ws),
    getWorkspaceConfig(params.ws),
    firstPartyOutcomesQuery(params.ws),
  ]);
  const minN = config?.minBaselineN ?? 20;

  // Overdue-first review queue.
  const now = Date.now();
  const queue = [...receipts].sort((a, b) => {
    const aDue = a.outcome === "pending" ? a.reviewAt.getTime() : Infinity;
    const bDue = b.outcome === "pending" ? b.reviewAt.getTime() : Infinity;
    return aDue - bDue;
  });

  // Aggregates are gated on the workspace minimum-N over first-party rows.
  const gate = minNGate(firstParty.length, minN);
  const totals = firstParty.reduce(
    (acc, o) => ({
      leads: acc.leads + o.leads,
      qualified: acc.qualified + o.qualifiedLeads,
      pipeline: acc.pipeline + (o.pipelineContribution ?? 0),
      quality: acc.quality + (o.qualityScore ?? 0),
    }),
    { leads: 0, qualified: 0, pipeline: 0, quality: 0 },
  );

  return (
    <PlatinaPage
      eyebrow="Platina · Outcomes"
      title="Outcomes and decision history"
      description="Close the loop: import consented results, grade each receipt against its hypothesis. Measured outcomes become approved evidence; contradicted hypotheses are demoted and retained."
    >
      <PlatinaFormError message={searchParams.error} />

      <section aria-label="Import outcomes" className="mb-8">
        <form
          action={importOutcomesAction}
          className="rounded-lg border border-border bg-card p-4"
        >
          <h2 className="text-sm font-medium">Import consented outcomes</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Pasted CSV with header: leads, qualified_leads, conversion_rate,
            pipeline_contribution, quality_score (optional), campaign_id
            (optional), receipt_id (optional), recorded_at (optional).
            Duplicate rows are skipped by content hash.
          </p>
          <input type="hidden" name="workspaceId" value={params.ws} />
          <textarea
            name="csv"
            required
            rows={4}
            placeholder="leads,qualified_leads,conversion_rate,pipeline_contribution"
            className="mt-2 w-full rounded-md border border-input bg-background p-3 font-mono text-xs"
          />
          <button
            type="submit"
            className="mt-3 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Import outcomes
          </button>
        </form>
        {imports.length > 0 && (
          <ul className="mt-3 space-y-1">
            {imports.slice(0, 5).map((i) => (
              <li
                key={i.id}
                className="font-mono text-[11px] text-muted-foreground"
              >
                {i.createdAt.toISOString().slice(0, 10)} · {i.source} ·{" "}
                {i.insertedCount} inserted · {i.skippedCount} skipped
                {i.errors.length > 0 ? ` · ${i.errors.length} row errors` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Aggregate lead quality" className="mb-8">
        <h2 className="font-display text-lg font-medium">
          Aggregate lead quality
        </h2>
        {gate.status === "insufficient_baseline" ? (
          <div className="mt-3 rounded-lg border border-border bg-secondary p-4 text-sm text-secondary-foreground">
            Insufficient baseline — {gate.sampleSize} of {minN} first-party
            outcomes on record. Aggregates stay hidden until the baseline is
            real; individual rows are listed below.
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Leads
              </p>
              <p className="mt-1 font-display text-2xl">{totals.leads}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Qualified
              </p>
              <p className="mt-1 font-display text-2xl">{totals.qualified}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Pipeline
              </p>
              <p className="mt-1 font-display text-2xl">
                {totals.pipeline.toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Avg quality (heuristic)
              </p>
              <p className="mt-1 font-display text-2xl">
                {(totals.quality / firstParty.length).toFixed(2)}
              </p>
            </div>
          </div>
        )}
      </section>

      <section aria-label="Review queue">
        <h2 className="font-display text-lg font-medium">Review queue</h2>
        {queue.length === 0 ? (
          <div className="mt-3 rounded-lg border border-border bg-secondary p-5 text-sm text-secondary-foreground">
            No decision receipts yet. Approving a solution direction records
            one automatically.
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {queue.map((r) => {
              const overdue =
                r.outcome === "pending" && r.reviewAt.getTime() < now;
              return (
                <li
                  key={r.id}
                  className="rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{r.title}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        Hypothesis: {r.hypothesis}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {overdue && (
                        <span className="rounded bg-destructive/10 px-2 py-0.5 font-mono text-[11px] text-destructive">
                          Overdue
                        </span>
                      )}
                      <span className="rounded bg-secondary px-2 py-0.5 font-mono text-[11px] text-secondary-foreground">
                        {VERDICT_LABEL[r.outcome] ?? r.outcome}
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                    review due {r.reviewAt.toISOString().slice(0, 10)} ·
                    approved evidence {r.evidenceBrandIds.length} · hypotheses{" "}
                    {r.evidenceBrainIds.length}
                  </p>
                  {r.outcome === "pending" && (
                    <form
                      action={gradeReceiptAction}
                      className="mt-3 flex flex-wrap items-center gap-2"
                    >
                      <input type="hidden" name="workspaceId" value={params.ws} />
                      <input type="hidden" name="receiptId" value={r.id} />
                      <select
                        name="outcome"
                        className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                      >
                        <option value="worked">Worked</option>
                        <option value="did_not_work">Did not work</option>
                        <option value="inconclusive">Inconclusive</option>
                      </select>
                      <input
                        name="outcomeNote"
                        placeholder="Note (measurement provenance)"
                        className="min-w-48 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
                      />
                      <button
                        type="submit"
                        className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                      >
                        Record verdict
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="Recorded outcomes" className="mt-8">
        <h2 className="font-display text-lg font-medium">Recorded outcomes</h2>
        {outcomes.length === 0 ? (
          <div className="mt-3 rounded-lg border border-border bg-secondary p-5 text-sm text-secondary-foreground">
            No measured outcomes imported yet. Nothing here is estimated.
          </div>
        ) : (
          <div className="mt-3 overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary text-left">
                  <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Recorded
                  </th>
                  <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Leads
                  </th>
                  <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Qualified
                  </th>
                  <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Conversion
                  </th>
                  <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Pipeline
                  </th>
                  <th className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Quality
                  </th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map((o) => (
                  <tr key={o.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-mono text-xs">
                      {o.recordedAt.toISOString().slice(0, 10)}
                      {o.synthetic && (
                        <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase text-secondary-foreground">
                          Synthetic — not evidence
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">{o.leads}</td>
                    <td className="px-4 py-3">{o.qualifiedLeads}</td>
                    <td className="px-4 py-3">
                      {o.conversionRate != null
                        ? `${(o.conversionRate * 100).toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {o.pipelineContribution != null
                        ? o.pipelineContribution.toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {o.qualityScore != null ? o.qualityScore.toFixed(2) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PlatinaPage>
  );
}
