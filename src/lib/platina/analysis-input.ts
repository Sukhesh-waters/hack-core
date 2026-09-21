/**
 * What the validation round actually reads (core spine R2). Pure.
 *
 * Until now the debate was handed `title\nbody` and nothing else: no
 * competitor, no client, no source kind, no sense of whether anything had
 * changed. An anonymous wall of text asked for "a market driver" produces an
 * anonymous market driver — which is the mechanical reason findings read like
 * a sitemap rather than intelligence.
 *
 * Order matters and is asserted in tests: identity first (who is this about),
 * then the change (the actual signal), then measurements, then the page text
 * as context. A model reads the top of a prompt most carefully; the page body
 * is the least important part of it.
 *
 * Nothing here invents: an unlinked source says so in words rather than
 * guessing a competitor name.
 */
import type { PlatinaSignalMetrics } from "@/db/platina-schema";

export type AnalysisSubject = {
  /** The brand this page belongs to. Null when the source has no client link. */
  competitorName: string | null;
  /** The own_brand this competitor is watched for. */
  clientName: string | null;
  sourceKind: string | null;
  url: string;
  collectedAt: Date | string;
};

export type AnalysisInputParts = {
  subject: AnalysisSubject;
  title: string | null;
  body: string;
  /** From summariseChange(). Null means "nothing meaningful changed". */
  change: { summary: string } | null;
  metrics?: PlatinaSignalMetrics | null;
};

/** Page text budget. The change summary and identity are never truncated. */
export const BODY_BUDGET = 3500;

export const UNLINKED_SUBJECT =
  "unknown (this source is not linked to a client yet)";

const date = (value: Date | string) => new Date(value).toISOString().slice(0, 10);

const KIND_LABEL: Record<string, string> = {
  competitor_site: "a page on the competitor's own website",
  press_release: "a press release",
  trade_editorial: "trade press coverage",
  conference: "a conference listing",
  ad_library: "a live ad from the public ad library",
  social_posts: "a social post",
  social_profile: "a social profile",
};

/** Measured engagement as one line. Absent numbers stay absent. */
export function describeMetrics(metrics: PlatinaSignalMetrics | null | undefined): string | null {
  if (!metrics) return null;
  const parts: string[] = [];
  if (metrics.likes !== undefined) parts.push(`${metrics.likes} likes`);
  if (metrics.comments !== undefined) parts.push(`${metrics.comments} comments`);
  if (metrics.views !== undefined) parts.push(`${metrics.views} views`);
  if (metrics.shares !== undefined) parts.push(`${metrics.shares} shares`);
  if (metrics.followers !== undefined) parts.push(`${metrics.followers} followers`);
  if (parts.length === 0) return null;
  const posted = metrics.postedAt ? `, posted ${date(metrics.postedAt)}` : "";
  return `${parts.join(", ")}${posted}`;
}

export function buildAnalysisInput(input: AnalysisInputParts): string {
  const { subject } = input;
  const sections: string[] = [];

  const identity = [
    `Competitor: ${subject.competitorName ?? UNLINKED_SUBJECT}`,
    ...(subject.clientName ? [`Watched for client: ${subject.clientName}`] : []),
    `Source: ${KIND_LABEL[subject.sourceKind ?? ""] ?? subject.sourceKind ?? "a public web page"} — ${subject.url}`,
    `Collected: ${date(subject.collectedAt)}`,
    ...(input.title ? [`Page title: ${input.title}`] : []),
  ];
  sections.push(identity.join("\n"));

  if (input.change) {
    sections.push(`WHAT CHANGED — this is the signal:\n${input.change.summary}`);
  } else {
    sections.push(
      "WHAT CHANGED: nothing was collected for this page before, so this is a first look, not a change.",
    );
  }

  const metrics = describeMetrics(input.metrics);
  if (metrics) {
    sections.push(
      `MEASURED ENGAGEMENT (real numbers from the platform, not claims): ${metrics}`,
    );
  }

  const body = input.body.trim();
  const truncated = body.length > BODY_BUDGET;
  sections.push(
    `PAGE TEXT${truncated ? ` (first ${BODY_BUDGET} of ${body.length} characters)` : ""}:\n` +
      (truncated ? `${body.slice(0, BODY_BUDGET)}\n[…truncated]` : body),
  );

  return sections.join("\n\n");
}
