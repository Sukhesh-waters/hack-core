import type { RetrievalBuckets } from "./retrieval";
import { checkSupport, labelBuckets, minNGate } from "./retrieval";

export type CampaignProposal = {
  title: string;
  hook: string;
  whyEvidence: string;
  whyHypothesis: string;
  evidenceIds: string[];
  hypothesisIds: string[];
};

export function buildIdeationBrief(buckets: RetrievalBuckets, minN: number) {
  const gate = minNGate(buckets.evidence.length, minN);
  const support = checkSupport(buckets, minN);
  const labelled = labelBuckets(buckets);
  return { gate, support, labelled };
}

export function draftProposals(
  topic: string,
  buckets: RetrievalBuckets,
): CampaignProposal[] {
  const labelled = labelBuckets(buckets);
  if (labelled.evidence.length === 0) return [];
  return [
    {
      title: `${topic} — evidence-led campaign`,
      hook: labelled.evidence[0]?.content.slice(0, 120) ?? topic,
      whyEvidence: `${labelled.evidenceLabel}: ${labelled.evidence
        .slice(0, 2)
        .map((e) => e.content.slice(0, 80))
        .join(" · ")}`,
      whyHypothesis:
        labelled.hypotheses.length > 0
          ? `${labelled.hypothesisLabel}: ${labelled.hypotheses[0].content.slice(0, 80)}`
          : "No unvalidated market pattern cited.",
      evidenceIds: labelled.evidence.map((e) => e.id),
      hypothesisIds: labelled.hypotheses.map((h) => h.id),
    },
  ];
}

export function proposeCampaignDetail(input: {
  title: string;
  hypothesis: string;
}) {
  return {
    durationDays: 90,
    geography: "North America",
    budget: 75000,
    channelMix: ["conference", "email", "web"],
    eventLabel: "anchor event",
    audience: "method-validation leads",
    contentPlan: `Pre / at / post plan for ${input.title}. Hypothesis: ${input.hypothesis}`,
  };
}
