/**
 * What happens to one collected document before any provider is called
 * (core spine R1+R2). This is where the cost guarantee lives: if this returns
 * a skip, no model call, no embedding and no previous-version query happen.
 *
 * DB-free — the caller injects `loadPrevious`, so the ordering guarantee
 * ("cheap checks first") is provable in a unit test rather than asserted in a
 * comment.
 */
import { buildAnalysisInput, type AnalysisSubject } from "./analysis-input";
import { summariseChange, type ChangeSide } from "./change-diff";
import { scoreSignal } from "./signal-value";
import type { PlatinaSignalMetrics } from "@/db/platina-schema";

export type AnalysisSubjectRow = {
  kind: string | null;
  brandName: string | null;
  clientName: string | null;
  sourceKind: string | null;
} | null;

export type AnalysisSignalRow = {
  title: string | null;
  body: string;
  sourceUrl: string;
  canonicalUrl: string | null;
  sourceKind: string | null;
  fetchedAt: Date | string;
  metrics?: PlatinaSignalMetrics | null;
};

export type AnalysisPlan =
  | { action: "skip"; reason: string; cause: "own_brand" | "low_value" }
  | { action: "analyse"; input: string; changed: boolean };

export const OWN_BRAND_SKIP = "the client's own page — used for its profile";

export async function planAnalysis(params: {
  signal: AnalysisSignalRow;
  subject: AnalysisSubjectRow;
  /** Called only when the document has earned an analysis. */
  loadPrevious: () => Promise<ChangeSide | null>;
}): Promise<AnalysisPlan> {
  const { signal, subject } = params;

  // 1. A client's own page feeds its profile, never the competitor debate.
  if (subject?.kind === "own_brand") {
    return { action: "skip", reason: OWN_BRAND_SKIP, cause: "own_brand" };
  }

  // 2. Is it worth two model calls? Cheapest check, so it comes before any IO.
  const verdict = scoreSignal({
    url: signal.canonicalUrl ?? signal.sourceUrl,
    title: signal.title,
    body: signal.body,
    sourceKind: signal.sourceKind ?? subject?.sourceKind ?? null,
    metricsPresent: Boolean(signal.metrics),
  });
  if (!verdict.worthAnalysing) {
    return { action: "skip", reason: verdict.reason, cause: "low_value" };
  }

  // 3. Only now: what did this page look like last time?
  const previous = await params.loadPrevious();
  const change = previous
    ? summariseChange(previous, {
        title: signal.title,
        body: signal.body,
        fetchedAt: signal.fetchedAt,
      })
    : null;

  const analysisSubject: AnalysisSubject = {
    competitorName: subject?.brandName ?? null,
    clientName: subject?.clientName ?? null,
    sourceKind: signal.sourceKind ?? subject?.sourceKind ?? null,
    url: signal.canonicalUrl ?? signal.sourceUrl,
    collectedAt: signal.fetchedAt,
  };

  return {
    action: "analyse",
    changed: change !== null,
    input: buildAnalysisInput({
      subject: analysisSubject,
      title: signal.title,
      body: signal.body,
      change,
      metrics: signal.metrics ?? null,
    }),
  };
}
