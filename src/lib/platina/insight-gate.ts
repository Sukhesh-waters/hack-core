/**
 * B3 — the deterministic gate (Metacognitive Brain plan §5 B3, §7). Pure,
 * DB-free: every input is already computed by the caller (signal-analyze.ts
 * reads `n` through an injected reader — falsifier-metrics.ts measureMetric
 * — and runs the significance test via significance.ts before calling this).
 *
 * Runs after the challenger and before any Brain write. Checks:
 *  1. Schema validity — B1's own validateInterrogation verdict.
 *  2. Testability (min-N) — the falsifier's segment must already have at
 *     least the metric's declared minN observations, or the claim can never
 *     be graded.
 *  3. Significance — for a claim about a measured trend, a one-sided
 *     Mann-Whitney result at the configured p (significance.ts); omitted by
 *     the caller for anything that is not a trend claim (a fact, or a
 *     falsifier whose metric is not framed as a recent-vs-baseline trend).
 *
 * "Deterministic beats model": `resolveState` is accepted so a caller or
 * test can show the invariant below holds, but it is never read to flip
 * `pass` — no agreement state, however strong, can override a refusal here.
 */
import type { ResolveState } from "./contradiction";
import type { ValidateInterrogationResult } from "./interrogation";

export type GateTestability = { n: number; minN: number } | null;

export type GateSignificance = { significant: boolean; reason: string };

export type GateInput = {
  /** B1's schema-validity verdict (interrogation.ts validateInterrogation's return). */
  interrogation: ValidateInterrogationResult;
  /** The claim's own falsifier, or null for a fact (falsifier-exempt) or an already-invalid reply. Carried for context; the pass/fail decision below reads only `testability`. */
  falsifier: { metric: string } | null;
  /** `{ n, minN }` when the claim carries a falsifier to test; null when there is nothing to test (a fact, or a claim already rejected by `interrogation`). */
  testability: GateTestability;
  /** Present only when the claim is about a measured trend; omitted, the significance check is skipped entirely (not a pass by default — simply not asked). */
  significance?: GateSignificance;
  /** The debate's resolved agreement state. Recorded for the caller/tests only — see the module doc comment. */
  resolveState: ResolveState;
};

export type GateResult = { pass: boolean; reasons: string[] };

/** Said when the segment has not yet collected enough history to test this claim (plan §9 operator copy: "insufficient" -> "Not enough data to test yet"). */
export const NOT_ENOUGH_DATA_REASON = "Not enough data to test yet.";
/** Said when a stated trend does not clear the significance test. */
export const NOT_SIGNIFICANT_REASON = "Not clearly different from usual.";

export function gateInsight(input: GateInput): GateResult {
  const reasons: string[] = [];

  if (!input.interrogation.ok) {
    reasons.push(input.interrogation.reason);
  }
  if (input.testability && input.testability.n < input.testability.minN) {
    reasons.push(NOT_ENOUGH_DATA_REASON);
  }
  if (input.significance && !input.significance.significant) {
    reasons.push(
      input.significance.reason.startsWith("not enough data") ? NOT_ENOUGH_DATA_REASON : NOT_SIGNIFICANT_REASON,
    );
  }

  // `input.resolveState` is read nowhere above — by construction, not by
  // discipline: there is no branch here that could consult it even by
  // accident, which is what brain-invariants.test.ts's B3 test proves at the
  // wiring level (an "agreed" debate state next to a gate refusal still
  // produces no Brain chunk).
  return { pass: reasons.length === 0, reasons };
}
