import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { listOutcomes, listReceipts } from "@/db/queries/platina";
import { gradeReceiptAction } from "../actions";

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
  const [receipts, outcomes] = await Promise.all([
    listReceipts(params.ws),
    listOutcomes(params.ws),
  ]);

  return (
    <PlatinaPage
      eyebrow="Platina · Outcomes"
      title="Outcomes and decision history"
      description="Close the loop: grade each recorded result against the hypothesis it tested. Measured outcomes become approved evidence; contradicted hypotheses are demoted."
    >
      <PlatinaFormError message={searchParams.error} />

      <section aria-label="Review queue">
        <h2 className="font-display text-lg font-medium">Review queue</h2>
        {receipts.length === 0 ? (
          <div className="mt-3 rounded-lg border border-border bg-secondary p-5 text-sm text-secondary-foreground">
            No decision receipts yet. Approving a solution direction records
            one automatically.
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {receipts.map((r) => (
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
                  <span className="rounded bg-secondary px-2 py-0.5 font-mono text-[11px] text-secondary-foreground">
                    {VERDICT_LABEL[r.outcome] ?? r.outcome}
                  </span>
                </div>
                <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                  review due {r.reviewAt.toISOString().slice(0, 10)} · approved
                  evidence {r.evidenceBrandIds.length} · hypotheses{" "}
                  {r.evidenceBrainIds.length}
                </p>
                {r.outcome === "pending" && (
                  <form
                    action={gradeReceiptAction}
                    className="mt-3 flex items-center gap-2"
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
                    <button
                      type="submit"
                      className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                    >
                      Record verdict
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Recorded outcomes" className="mt-8">
        <h2 className="font-display text-lg font-medium">Recorded outcomes</h2>
        {outcomes.length === 0 ? (
          <div className="mt-3 rounded-lg border border-border bg-secondary p-5 text-sm text-secondary-foreground">
            No measured outcomes imported yet. Consented outcome imports arrive
            with the Outcomes slice; nothing here is estimated.
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
