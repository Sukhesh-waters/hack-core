import { PlatinaMovedNotice } from "@/components/platina/moved-notice";
import { PlatinaPage } from "@/components/platina/page";
import { listBrainChunks } from "@/db/queries/platina";
import {
  INSIGHT_REJECT_REASON_LABEL,
  INSIGHT_REJECT_REASONS,
} from "@/lib/platina/insight-review";
import { reviewInsightAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function BrainPage(
  props: {
    params: Promise<{ ws: string }>;
  }
) {
  const params = await props.params;
  const chunks = await listBrainChunks(params.ws);

  return (
    <PlatinaPage eyebrow="Knowledge" title="Brain">
      <PlatinaMovedNotice
        workspaceId={params.ws}
        to="findings"
        label="Findings"
      />
      <p className="mb-4 text-sm text-muted-foreground">
        Derived insights that survived contradiction. Citable as hypothesis only.
        Gen-0 sources are never rewritten.
      </p>
      <ul className="space-y-3">
        {chunks.map((c) => (
          <li key={c.id} className="rounded-md border border-border p-3 text-sm">
            <p>{c.content}</p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              gen {c.generation} · {c.agreementState} · confidence{" "}
              {c.confidence.toFixed(2)} · {c.status}
            </p>
            <form
              action={reviewInsightAction}
              className="mt-2 flex flex-wrap items-center gap-2 text-xs"
            >
              <input type="hidden" name="workspaceId" value={params.ws} />
              <input type="hidden" name="chunkId" value={c.id} />
              <input type="hidden" name="returnTo" value="brain" />
              <select
                name="rejectReason"
                defaultValue="wrong_fact"
                className="rounded-md border border-input bg-background px-2 py-1 text-xs"
              >
                {INSIGHT_REJECT_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {INSIGHT_REJECT_REASON_LABEL[reason]}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                name="action"
                value="approve"
                className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground"
              >
                Approve
              </button>
              <button
                type="submit"
                name="action"
                value="reject"
                className="rounded-md border border-border px-2.5 py-1 text-xs"
              >
                Reject
              </button>
            </form>
          </li>
        ))}
        {chunks.length === 0 && (
          <li className="text-sm text-muted-foreground">
            No Brain insights yet. Confirm a scan to feed plane B, then the
            contradiction sweep writes here.
          </li>
        )}
      </ul>
    </PlatinaPage>
  );
}
