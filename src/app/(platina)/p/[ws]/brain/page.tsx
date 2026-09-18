import { PlatinaMovedNotice } from "@/components/platina/moved-notice";
import { PlatinaPage } from "@/components/platina/page";
import { listBrainChunks } from "@/db/queries/platina";

export const dynamic = "force-dynamic";

export default async function BrainPage({
  params,
}: {
  params: { ws: string };
}) {
  const chunks = await listBrainChunks(params.ws);

  return (
    <PlatinaPage eyebrow="S6–S7 · plane C" title="Brain">
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
