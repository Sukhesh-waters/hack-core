import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaMovedNotice } from "@/components/platina/moved-notice";
import { PlatinaPage } from "@/components/platina/page";
import { listReceipts } from "@/db/queries/platina";
import { gradeReceiptAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ReceiptsPage({
  params,
  searchParams,
}: {
  params: { ws: string };
  searchParams: { error?: string };
}) {
  const receipts = await listReceipts(params.ws);

  return (
    <PlatinaPage eyebrow="S9 · S12" title="Decision receipts">
      <PlatinaMovedNotice
        workspaceId={params.ws}
        to="outcomes"
        label="Outcomes"
      />
      <PlatinaFormError message={searchParams.error} />
      <ul className="space-y-3">
        {receipts.map((r) => (
          <li key={r.id} className="rounded-md border border-border p-3 text-sm">
            <p className="font-medium">{r.title}</p>
            <p className="text-muted-foreground">Hypothesis: {r.hypothesis}</p>
            <p className="font-mono text-[11px] text-muted-foreground">
              {r.outcome} · review {r.reviewAt.toISOString().slice(0, 10)} · A
              evidence {r.evidenceBrandIds.length} · C evidence{" "}
              {r.evidenceBrainIds.length}
            </p>
            {r.outcome === "pending" && (
              <form action={gradeReceiptAction} className="mt-2 flex gap-2">
                <input type="hidden" name="workspaceId" value={params.ws} />
                <input type="hidden" name="receiptId" value={r.id} />
                <select
                  name="outcome"
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                >
                  <option value="worked">worked</option>
                  <option value="did_not_work">did_not_work</option>
                  <option value="inconclusive">inconclusive</option>
                </select>
                <button type="submit" className="text-xs underline">
                  Grade
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </PlatinaPage>
  );
}
