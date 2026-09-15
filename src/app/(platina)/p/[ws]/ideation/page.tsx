import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { listBrandChunks, listBrainChunks } from "@/db/queries/platina";
import { draftProposals } from "@/lib/platina/ideation";
import { checkSupport, minNGate } from "@/lib/platina/retrieval";
import { approveDirectionAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function IdeationPage({
  params,
  searchParams,
}: {
  params: { ws: string };
  searchParams: { error?: string };
}) {
  const [brand, brain] = await Promise.all([
    listBrandChunks(params.ws),
    listBrainChunks(params.ws),
  ]);
  const buckets = {
    evidence: brand.map((c) => ({
      id: c.id,
      content: c.content,
      plane: "A" as const,
    })),
    hypotheses: brain.map((c) => ({
      id: c.id,
      content: c.content,
      plane: "C" as const,
      confidence: c.confidence,
      generation: c.generation,
    })),
  };
  const gate = minNGate(buckets.evidence.length, 1);
  const support = checkSupport(buckets);
  const proposals = support.ok ? draftProposals("Waters campaign", buckets) : [];

  return (
    <PlatinaPage eyebrow="S8–S10 · gate 3" title="Ideation">
      <PlatinaFormError message={searchParams.error} />
      {gate.status === "insufficient_baseline" && (
        <p className="mb-4 rounded-md border border-border p-3 text-sm">
          Insufficient baseline — {gate.sampleSize} plane-A chunks.
        </p>
      )}
      {!support.ok && (
        <p className="mb-4 rounded-md border border-border p-3 text-sm">
          Support refused: {support.reason}. A Plane C chunk is never sole
          support.
        </p>
      )}
      {proposals.map((p) => (
        <article key={p.title} className="mb-6 rounded-md border border-border p-4">
          <h2 className="font-medium">{p.title}</h2>
          <p className="mt-2 text-sm">{p.whyEvidence}</p>
          <p className="mt-1 text-sm text-muted-foreground">{p.whyHypothesis}</p>
          <form action={approveDirectionAction} className="mt-4 space-y-2">
            <input type="hidden" name="workspaceId" value={params.ws} />
            <input type="hidden" name="title" value={p.title} />
            <input type="hidden" name="evidenceBrandIds" value={p.evidenceIds.join(",")} />
            <input type="hidden" name="evidenceBrainIds" value={p.hypothesisIds.join(",")} />
            <input
              name="hypothesis"
              required
              placeholder="Record the hypothesis this campaign will test"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <input
              name="expectedOutcome"
              placeholder="Expected outcome"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            >
              Gate 3 · approve direction
            </button>
          </form>
        </article>
      ))}
    </PlatinaPage>
  );
}
