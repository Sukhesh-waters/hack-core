import { PlatinaPage } from "@/components/platina/page";
import { listBrainChunks } from "@/db/queries/platina";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platina findings" };

/**
 * Derived market hypotheses that survived contradiction. Technical
 * provenance (generation, agreement state, confidence) lives in the
 * expandable panel per the copy glossary — never in primary copy.
 */
export default async function FindingsPage({
  params,
}: {
  params: { ws: string };
}) {
  const hypotheses = await listBrainChunks(params.ws);

  return (
    <PlatinaPage
      eyebrow="Platina · Findings"
      title="Findings"
      description="Market patterns Platina has derived from approved public sources. These are hypotheses, not validated evidence — they inform, they never prove."
    >
      {hypotheses.length === 0 ? (
        <div className="rounded-lg border border-border bg-secondary p-5 text-sm text-secondary-foreground">
          No findings yet. They appear after an approved audit runs and the
          validation pass resolves. Define a source in Audits to begin.
        </div>
      ) : (
        <ul className="space-y-3">
          {hypotheses.map((h) => (
            <li
              key={h.id}
              className="rounded-lg border border-border bg-card p-4"
            >
              <p className="text-sm">{h.content}</p>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                Derived market hypothesis · not yet validated
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer font-mono text-[11px] text-muted-foreground">
                  Technical provenance
                </summary>
                <dl className="mt-2 grid grid-cols-2 gap-2 rounded-md bg-secondary p-3 font-mono text-[11px] text-secondary-foreground md:grid-cols-4">
                  <div>
                    <dt className="uppercase">generation</dt>
                    <dd>{h.generation}</dd>
                  </div>
                  <div>
                    <dt className="uppercase">agreement</dt>
                    <dd>{h.agreementState}</dd>
                  </div>
                  <div>
                    <dt className="uppercase">confidence</dt>
                    <dd>{h.confidence.toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt className="uppercase">status</dt>
                    <dd>{h.status}</dd>
                  </div>
                </dl>
              </details>
            </li>
          ))}
        </ul>
      )}
    </PlatinaPage>
  );
}
