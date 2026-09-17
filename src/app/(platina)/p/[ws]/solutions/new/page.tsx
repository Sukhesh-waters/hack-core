import { PlatinaFormError } from "@/components/platina/form-error";
import { PlatinaPage } from "@/components/platina/page";
import { getFinding, getWorkspaceConfig } from "@/db/queries/platina";
import { draftProposals } from "@/lib/platina/ideation";
import { retrieveBuckets } from "@/lib/platina/retrieve";
import {
  checkSupport,
  minNGate,
  relevanceGate,
} from "@/lib/platina/retrieval";
import { approveDirectionAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platina — new solution" };

const USE_CASES = [
  { value: "competitor_change", label: "Competitor / market change" },
  { value: "event_readiness", label: "Conference / event readiness" },
  { value: "brand_drift", label: "Brand drift remediation" },
  { value: "claims", label: "Claims and compliance" },
  { value: "campaign_performance", label: "Campaign performance" },
];

/**
 * Topic-driven, evidence-grounded drafting. Retrieval runs server-side over
 * the version-current vector store plus lexical search, fused and reranked.
 * The two buckets stay separate and differently labelled; the similarity
 * floor and the workspace minimum-N are enforced before any proposal shows.
 */
export default async function NewSolutionPage({
  params,
  searchParams,
}: {
  params: { ws: string };
  searchParams: { error?: string; findingId?: string; topic?: string };
}) {
  const [config, finding] = await Promise.all([
    getWorkspaceConfig(params.ws),
    searchParams.findingId
      ? getFinding(params.ws, searchParams.findingId)
      : Promise.resolve(null),
  ]);
  const minN = config?.minBaselineN ?? 20;
  const floor = config?.similarityFloor ?? 0.35;

  const topic =
    searchParams.topic ??
    (finding ? `${finding.title}\n${finding.summary}` : "");
  const retrieved = topic.trim()
    ? await retrieveBuckets(params.ws, topic)
    : null;

  const buckets = retrieved ?? { evidence: [], hypotheses: [] };
  const gate = minNGate(buckets.evidence.length, minN);
  const support = checkSupport(buckets);
  const relevance = retrieved
    ? relevanceGate(
        {
          bestVectorScore: retrieved.bestEvidenceScore,
          hasLexicalHit: retrieved.hasEvidenceLexicalHit,
        },
        floor,
      )
    : { status: "ready" as const };

  const ready =
    support.ok && gate.status === "ready" && relevance.status === "ready";
  const proposals =
    ready && topic.trim() ? draftProposals(finding?.title ?? topic, buckets) : [];

  return (
    <PlatinaPage
      eyebrow="Platina · Solutions"
      title="New solution"
      description="A solution must rest on approved evidence. Derived market hypotheses may inform it, but can never be its only support."
    >
      <PlatinaFormError message={searchParams.error} />

      {finding && (
        <div className="mb-6 rounded-lg border border-border bg-accent/40 p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            In response to finding
          </p>
          <p className="mt-1 font-medium">{finding.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{finding.summary}</p>
        </div>
      )}

      <form className="mb-6 rounded-lg border border-border bg-card p-4" method="GET">
        {searchParams.findingId && (
          <input type="hidden" name="findingId" value={searchParams.findingId} />
        )}
        <label className="text-xs font-medium">
          What are you responding to?
          <textarea
            name="topic"
            rows={2}
            defaultValue={topic}
            placeholder="e.g. Competitor launched a mid-range LC-MS for QC labs"
            className="mt-1 w-full rounded-md border border-input bg-background p-3 text-sm"
          />
        </label>
        <button
          type="submit"
          className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm"
        >
          Retrieve evidence
        </button>
      </form>

      {retrieved && (
        <section aria-label="Retrieved evidence" className="mb-6">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-primary">
                Approved evidence ({buckets.evidence.length})
              </p>
              <ul className="mt-2 space-y-2">
                {buckets.evidence.map((e) => (
                  <li key={e.id} className="text-sm">
                    {e.content.slice(0, 140)}
                  </li>
                ))}
                {buckets.evidence.length === 0 && (
                  <li className="text-sm text-muted-foreground">
                    None retrieved for this topic.
                  </li>
                )}
              </ul>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Derived market hypotheses — unvalidated (
                {buckets.hypotheses.length})
              </p>
              <ul className="mt-2 space-y-2">
                {buckets.hypotheses.map((h) => (
                  <li key={h.id} className="text-sm text-muted-foreground">
                    {h.content.slice(0, 140)}
                  </li>
                ))}
                {buckets.hypotheses.length === 0 && (
                  <li className="text-sm text-muted-foreground">None.</li>
                )}
              </ul>
            </div>
          </div>
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            {retrieved.reranked
              ? "Ranked by relevance pass"
              : "Ranked by fused vector + lexical order"}
          </p>
        </section>
      )}

      {retrieved && relevance.status === "insufficient_relevance" && (
        <p className="mb-4 rounded-lg border border-border bg-secondary p-4 text-sm text-secondary-foreground">
          Nothing retrieved is relevant to this topic
          {relevance.bestScore !== null &&
            ` (best match ${(relevance.bestScore * 100).toFixed(0)}%, floor ${floor * 100}%)`}
          . The question does not match the evidence on record — reframe the
          topic or declare more of the standard in Admin. This is not a
          sample-size problem.
        </p>
      )}
      {retrieved && relevance.status === "ready" && gate.status === "insufficient_baseline" && (
        <p className="mb-4 rounded-lg border border-border bg-secondary p-4 text-sm text-secondary-foreground">
          Insufficient approved evidence — {gate.sampleSize} of {minN} required
          on record. Confirm more of the brand standard in Admin before
          drafting.
        </p>
      )}
      {retrieved && relevance.status === "ready" && gate.status === "ready" && !support.ok && (
        <p className="mb-4 rounded-lg border border-border bg-secondary p-4 text-sm text-secondary-foreground">
          A derived market hypothesis can never be the sole support for a
          solution. Anchor the direction in approved evidence first.
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
          <form action={approveDirectionAction} className="mt-4 space-y-3">
            <input type="hidden" name="workspaceId" value={params.ws} />
            <input type="hidden" name="title" value={p.title} />
            {finding && (
              <input type="hidden" name="findingId" value={finding.id} />
            )}
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

            <div className="grid gap-2 md:grid-cols-3">
              <label className="text-xs font-medium">
                Use case
                <select
                  name="useCase"
                  defaultValue="competitor_change"
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                >
                  {USE_CASES.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium">
                Severity
                <select
                  name="severity"
                  defaultValue={finding?.severity ?? "medium"}
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                >
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label className="text-xs font-medium">
                Urgency
                <select
                  name="urgency"
                  defaultValue="this_quarter"
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                >
                  <option value="immediate">Immediate</option>
                  <option value="this_quarter">This quarter</option>
                  <option value="monitor">Monitor</option>
                </select>
              </label>
            </div>

            <input
              name="hypothesis"
              required
              defaultValue={
                finding ? `Responding to: ${finding.title}` : undefined
              }
              placeholder="The hypothesis this solution will test"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <input
              name="expectedOutcome"
              placeholder="Expected outcome — what you will measure"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <input
              name="measurementMethod"
              placeholder="Measurement method — how the outcome will be recorded"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <div className="grid gap-2 md:grid-cols-2">
              <label className="text-xs font-medium">
                Event anchor date (required for event readiness)
                <input
                  name="eventAnchor"
                  type="date"
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                />
              </label>
              <label className="text-xs font-medium">
                Event label
                <input
                  name="eventLabel"
                  placeholder="ASMS 2026"
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                />
              </label>
            </div>
            <textarea
              name="strongestUncertainty"
              rows={2}
              defaultValue={finding?.strongestObjection ?? undefined}
              placeholder="Strongest uncertainty or counterargument"
              className="w-full rounded-md border border-input bg-background p-3 text-sm"
            />
            <button
              type="submit"
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              Approve direction
            </button>
          </form>
        </article>
      ))}
    </PlatinaPage>
  );
}
