import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { listBrandChunks, listBrainChunks } from "@/db/queries/platina";
import { draftProposals } from "@/lib/platina/ideation";
import { checkSupport, minNGate } from "@/lib/platina/retrieval";
import { approveDirectionAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platina — new solution" };

/**
 * Evidence-grounded solution drafting. Approved evidence and derived
 * hypotheses stay in separate, differently-labelled buckets; a hypothesis
 * can never be the sole support.
 */
export default async function NewSolutionPage({
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
    <PlatinaPage
      eyebrow="Platina · Solutions"
      title="New solution"
      description="A solution must rest on approved evidence. Derived market hypotheses may inform it, but can never be its only support."
    >
      <PlatinaFormError message={searchParams.error} />
      {gate.status === "insufficient_baseline" && (
        <p className="mb-4 rounded-lg border border-border bg-secondary p-4 text-sm text-secondary-foreground">
          Insufficient approved evidence — {gate.sampleSize} on record. Confirm
          the brand standard in Admin before drafting a direction.
        </p>
      )}
      {!support.ok && (
        <p className="mb-4 rounded-lg border border-border bg-secondary p-4 text-sm text-secondary-foreground">
          {support.reason === "insufficient_baseline"
            ? "Nothing to build on yet — no approved evidence and no derived hypotheses."
            : "A derived market hypothesis can never be the sole support for a solution. Anchor the direction in approved evidence first."}
        </p>
      )}
      {proposals.map((p) => (
        <article
          key={p.title}
          className="mb-6 rounded-lg border border-border bg-card p-5"
        >
          <h2 className="font-medium">{p.title}</h2>
          <p className="mt-2 text-sm">{p.whyEvidence}</p>
          <p className="mt-1 text-sm text-muted-foreground">{p.whyHypothesis}</p>
          <form action={approveDirectionAction} className="mt-4 space-y-2">
            <input type="hidden" name="workspaceId" value={params.ws} />
            <input type="hidden" name="title" value={p.title} />
            <input
              type="hidden"
              name="evidenceBrandIds"
              value={p.evidenceIds.join(",")}
            />
            <input
              type="hidden"
              name="evidenceBrainIds"
              value={p.hypothesisIds.join(",")}
            />
            <input
              name="hypothesis"
              required
              placeholder="The hypothesis this solution will test"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <input
              name="expectedOutcome"
              placeholder="Expected outcome — what you will measure"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            >
              Approve direction
            </button>
          </form>
        </article>
      ))}
    </PlatinaPage>
  );
}
