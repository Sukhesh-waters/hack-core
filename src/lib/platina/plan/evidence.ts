/**
 * Planner evidence (core spine S6). Pure. Evidence reaches the planner as two
 * separate lists — first-party baseline (Plane A) and public-signal patterns
 * (Plane B) — and stays separate all the way to the roadmap: a phase may cite
 * one plane, never both (two-layer rule).
 */
import type { PlanEvidenceSnapshot, PlanPhase } from "@/db/platina-schema";

export type PlanEvidence = {
  id: string;
  plane: "A" | "B";
  content: string;
  sourceUrl: string | null;
  collectedAt: Date | null;
  confidence: number | null;
  /** Arrived after the plan being revised was written. Prompt-only; not stored. */
  isNew?: boolean;
  /** W3b: the one counter-evidence item (may contradict the rest). Absent = support. */
  role?: "counter";
};

/** Evidence older than this is shown as stale, not hidden. */
export const EVIDENCE_STALE_DAYS = 30;
/** Top-k per plane; never truncate mid-chunk to fit. */
export const EVIDENCE_TOP_K = 6;

/** Unknown collection dates are not "stale" — the UI says "date unknown". */
export function isStale(
  collectedAt: Date | string | null,
  now: Date,
  staleDays = EVIDENCE_STALE_DAYS,
): boolean {
  if (!collectedAt) return false;
  const at = collectedAt instanceof Date ? collectedAt : new Date(collectedAt);
  if (Number.isNaN(at.getTime())) return false;
  return now.getTime() - at.getTime() > staleDays * 86_400_000;
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "date unknown");

/** One labelled block per plane. Ids are shown verbatim so the model can cite them. */
export function renderEvidenceBlock(header: string, items: PlanEvidence[]): string {
  if (items.length === 0) return `${header}: none.`;
  return [
    `${header}:`,
    ...items.map(
      (e) =>
        `[${e.id}] ${e.isNew ? "NEW " : ""}${e.content.replace(/\s+/g, " ").slice(0, 400)} (collected ${day(e.collectedAt)}${e.sourceUrl ? `, source ${e.sourceUrl}` : ""})`,
    ),
  ].join("\n");
}

export function snapshotEvidence(items: PlanEvidence[]): PlanEvidenceSnapshot[] {
  return items.map((e) => ({
    id: e.id,
    plane: e.plane,
    content: e.content,
    sourceUrl: e.sourceUrl,
    collectedAt: e.collectedAt ? e.collectedAt.toISOString() : null,
    confidence: e.confidence,
    ...(e.role ? { role: e.role } : {}),
  }));
}

/**
 * Deterministic citation check. Returns a reason when a phase cites an id the
 * planner was never shown, or mixes planes inside one phase; null when clean.
 */
export function findCitationProblem(
  phases: Pick<PlanPhase, "name" | "evidenceIds">[],
  evidence: PlanEvidence[],
): string | null {
  const plane = new Map(evidence.map((e) => [e.id, e.plane] as const));
  for (const phase of phases) {
    const ids = phase.evidenceIds ?? [];
    const unknown = ids.find((id) => !plane.has(id));
    if (unknown) {
      return `Phase "${phase.name}" cites evidence "${unknown}" that was not provided.`;
    }
    if (new Set(ids.map((id) => plane.get(id))).size > 1) {
      return `Phase "${phase.name}" cites both first-party and public evidence; a phase may rest on one only.`;
    }
  }
  return null;
}
