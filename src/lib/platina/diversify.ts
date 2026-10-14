/**
 * B6 anti-echo retrieval. Pure, DB-free.
 *
 * Prevents two failure modes: an echo chamber (a context full of near-
 * duplicate derived hypotheses that all repeat the same guess, with the
 * derived guesses crowding out first-party evidence and no counter-evidence
 * anywhere) and self-citation (a hypothesis that only supports itself or its
 * own lineage, which is not evidence at all).
 *
 * Composition order used by `diversifyEvidence`: MMR -> dropLineageDuplicates
 * -> capDerived -> disconfirming slot. The two-layer rule is never touched
 * here: planes are carried on each candidate and never merged or relabelled.
 */
import { similarity, words } from "./consolidate";

export type Plane = "A" | "B";
export type Direction = "up" | "down" | "none";
export type GradeState = "untested" | "holding" | "promoted" | "refuted" | "insufficient";

export type Lineage = { sourceSignalIds: string[]; absorbedChunkIds: string[] };

export type Candidate = {
  id: string;
  content: string;
  /** Higher is better. */
  relevance: number;
  /** Brain (derived) chunk = true; first-party pages/confirmed lessons = false. */
  derived: boolean;
  plane: Plane;
  subjectKey?: string | null;
  direction?: Direction | null;
  gradeState?: GradeState | null;
  status?: string;
  generation?: number;
  lineage?: Lineage;
};

export type SimilarityFn = (a: Candidate, b: Candidate) => number;

/** Default: Jaccard similarity over `words()` content tokens (reused from consolidate.ts). */
export const jaccardContentSimilarity: SimilarityFn = (a, b) =>
  similarity(words(a.content), words(b.content));

const EPS = 1e-9;

/**
 * Classic maximal marginal relevance. At each step picks the candidate that
 * maximizes `lambda * relevance - (1 - lambda) * maxSimilarityToSelected`.
 * Stable tie-breaks: equal MMR score -> higher relevance wins -> earlier
 * original position wins. At lambda = 1 this degenerates to a stable sort by
 * relevance descending (the similarity term never fires).
 */
export function mmr(
  candidates: Candidate[],
  k: number,
  lambda = 0.7,
  sim: SimilarityFn = jaccardContentSimilarity,
): Candidate[] {
  if (k <= 0 || candidates.length === 0) return [];
  const remaining = candidates.map((c, index) => ({ c, index }));
  const selected: { c: Candidate; index: number }[] = [];

  while (selected.length < k && remaining.length > 0) {
    let bestPos = -1;
    let best: { score: number; relevance: number; index: number } | null = null;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const maxSim =
        selected.length === 0
          ? 0
          : Math.max(...selected.map((s) => sim(cand.c, s.c)));
      const score = lambda * cand.c.relevance - (1 - lambda) * maxSim;
      if (
        best === null ||
        score > best.score + EPS ||
        (Math.abs(score - best.score) <= EPS &&
          (cand.c.relevance > best.relevance + EPS ||
            (Math.abs(cand.c.relevance - best.relevance) <= EPS && cand.index < best.index)))
      ) {
        best = { score, relevance: cand.c.relevance, index: cand.index };
        bestPos = i;
      }
    }
    selected.push(remaining[bestPos]);
    remaining.splice(bestPos, 1);
  }
  return selected.map((s) => s.c);
}

/**
 * Derived (Brain) chunks may use at most `derivedShare` of the evidence
 * token budget — relative to the BUDGET, not to what is present, so a
 * cold-start list with no first-party items still keeps derived items up to
 * the cap. Drops whole derived chunks, lowest relevance first, until the
 * derived total fits; first-party items are never touched here.
 */
export function capDerived(
  selected: Candidate[],
  opts: {
    evidenceTokenBudget: number;
    derivedShare?: number;
    tokensOf: (c: Candidate) => number;
  },
): Candidate[] {
  const derivedShare = opts.derivedShare ?? 0.4;
  const cap = opts.evidenceTokenBudget * derivedShare;
  const derived = selected.filter((c) => c.derived);
  if (derived.length === 0) return selected;

  // Lowest relevance first so the drop order matches "lowest relevance
  // first"; a stable id tie-break keeps this deterministic.
  const ascending = [...derived].sort(
    (a, b) => a.relevance - b.relevance || b.id.localeCompare(a.id),
  );
  let total = derived.reduce((s, c) => s + opts.tokensOf(c), 0);
  const dropped = new Set<string>();
  let i = 0;
  while (total > cap && i < ascending.length) {
    const c = ascending[i];
    total -= opts.tokensOf(c);
    dropped.add(c.id);
    i++;
  }
  return selected.filter((c) => !dropped.has(c.id));
}

function isActiveStatus(c: Candidate): boolean {
  return (c.status ?? "active") === "active";
}

function oppositeDirection(d: Direction | null | undefined): Direction | null {
  if (d === "up") return "down";
  if (d === "down") return "up";
  return null;
}

function mostRelevant(list: Candidate[]): Candidate | null {
  if (list.length === 0) return null;
  return list.reduce((best, c) => (c.relevance > best.relevance ? c : best), list[0]);
}

/**
 * Leading = the top derived chunk's subject and direction. Priority:
 * (1) the most relevant ACTIVE chunk with the same subjectKey and the
 * opposite direction; (2) else the most relevant REFUTED chunk on that
 * subject (refutation memory = negative evidence); (3) else null. Never
 * picks a chunk already in `selectedIds`.
 */
export function pickDisconfirming(
  leading: { subjectKey?: string | null; direction?: Direction | null },
  pool: Candidate[],
  selectedIds: Iterable<string>,
): Candidate | null {
  if (!leading.subjectKey) return null;
  const selected = new Set(selectedIds);
  const sameSubject = pool.filter(
    (c) => c.subjectKey === leading.subjectKey && !selected.has(c.id),
  );

  const opposite = oppositeDirection(leading.direction);
  if (opposite) {
    const active = sameSubject.filter((c) => isActiveStatus(c) && c.direction === opposite);
    const pick = mostRelevant(active);
    if (pick) return pick;
  }

  const refuted = sameSubject.filter((c) => c.gradeState === "refuted");
  return mostRelevant(refuted);
}

/**
 * Two chunks conflict when one absorbed the other (`absorbedChunkIds`), or
 * when they share any lineage via `sourceSignalIds`. A chunk never conflicts
 * with itself.
 */
export function lineageConflict(a: Candidate, b: Candidate): boolean {
  if (a.id === b.id) return false;
  const la = a.lineage ?? { sourceSignalIds: [], absorbedChunkIds: [] };
  const lb = b.lineage ?? { sourceSignalIds: [], absorbedChunkIds: [] };
  if (la.absorbedChunkIds.includes(b.id) || lb.absorbedChunkIds.includes(a.id)) return true;
  if (la.sourceSignalIds.length === 0 || lb.sourceSignalIds.length === 0) return false;
  return la.sourceSignalIds.some((id) => lb.sourceSignalIds.includes(id));
}

/**
 * A chunk and anything it conflicts with (absorbed, or shared source-signal
 * lineage) are never both kept: the higher-relevance one survives. Greedy
 * from highest relevance; original relative order is preserved among
 * survivors.
 */
export function dropLineageDuplicates(selected: Candidate[]): Candidate[] {
  const ordered = [...selected].sort(
    (a, b) => b.relevance - a.relevance || a.id.localeCompare(b.id),
  );
  const kept: Candidate[] = [];
  for (const c of ordered) {
    if (kept.some((k) => lineageConflict(k, c))) continue;
    kept.push(c);
  }
  const keptIds = new Set(kept.map((c) => c.id));
  return selected.filter((c) => keptIds.has(c.id));
}

/**
 * The self-citation write rule: true when NO id in `supportIds` is a signal
 * span ("sig:...") or a first-party id ("fp:..."), i.e. the support is
 * derived-only. An empty list is vacuously derived-only (true).
 */
export function derivedOnlySupport(supportIds: string[]): boolean {
  return !supportIds.some((id) => id.startsWith("sig:") || id.startsWith("fp:"));
}

export type DiversifyInput = {
  candidates: Candidate[];
  /** How many support items to keep before the disconfirming slot. */
  k: number;
  evidenceTokenBudget: number;
  derivedShare?: number;
  lambda?: number;
  tokensOf: (c: Candidate) => number;
  sim?: SimilarityFn;
};

export type DiversifiedItem = { role: "support" | "disconfirming"; candidate: Candidate };

export type DiversifyStats = {
  candidates: number;
  kept: number;
  derivedTokens: number;
  evidenceTokens: number;
  derivedShare: number;
  disconfirmingFilled: boolean;
  lineageDropped: number;
  nearDuplicatesDropped: number;
};

export type DiversifyResult = { items: DiversifiedItem[]; stats: DiversifyStats };

/**
 * MMR -> dropLineageDuplicates -> capDerived -> disconfirming slot. Planes
 * are carried on each candidate unchanged; the disconfirming item keeps its
 * own plane (never merged or relabelled with the support set's plane).
 */
export function diversifyEvidence(input: DiversifyInput): DiversifyResult {
  const { candidates, k, evidenceTokenBudget, tokensOf } = input;
  const lambda = input.lambda ?? 0.7;
  const derivedShare = input.derivedShare ?? 0.4;
  const sim = input.sim ?? jaccardContentSimilarity;

  // Only live, unrefuted chunks may SUPPORT anything. Refuted (demoted)
  // chunks stay in `candidates` for one purpose: the disconfirming slot,
  // where a recorded failure is exactly the counter-evidence wanted.
  const supportPool = candidates.filter((c) => isActiveStatus(c) && c.gradeState !== "refuted");
  const mmrSelected = mmr(supportPool, k, lambda, sim);

  // Telemetry: candidates a pure-relevance top-k would have kept, that MMR
  // displaced for diversity (lambda < 1 only; this is "near duplicates
  // dropped" in the loose, operator-facing sense — MMR's whole job).
  const pureTopKIds = new Set(
    [...supportPool]
      .sort((a, b) => b.relevance - a.relevance || a.id.localeCompare(b.id))
      .slice(0, k)
      .map((c) => c.id),
  );
  const mmrIds = new Set(mmrSelected.map((c) => c.id));
  const nearDuplicatesDropped = [...pureTopKIds].filter((id) => !mmrIds.has(id)).length;

  const afterLineage = dropLineageDuplicates(mmrSelected);
  const lineageDropped = mmrSelected.length - afterLineage.length;

  const afterCap = capDerived(afterLineage, { evidenceTokenBudget, derivedShare, tokensOf });

  const items: DiversifiedItem[] = afterCap.map((c) => ({ role: "support" as const, candidate: c }));

  const leadDerived = mostRelevant(afterCap.filter((c) => c.derived));
  let disconfirmingFilled = false;
  if (leadDerived) {
    const selectedIds = new Set(afterCap.map((c) => c.id));
    const disconfirming = pickDisconfirming(
      { subjectKey: leadDerived.subjectKey, direction: leadDerived.direction },
      candidates,
      selectedIds,
    );
    if (disconfirming) {
      items.push({ role: "disconfirming", candidate: disconfirming });
      disconfirmingFilled = true;
    }
  }

  const evidenceTokens = items.reduce((s, i) => s + tokensOf(i.candidate), 0);
  const derivedTokens = items
    .filter((i) => i.candidate.derived)
    .reduce((s, i) => s + tokensOf(i.candidate), 0);

  return {
    items,
    stats: {
      candidates: candidates.length,
      kept: items.length,
      derivedTokens,
      evidenceTokens,
      derivedShare: evidenceTokens > 0 ? derivedTokens / evidenceTokens : 0,
      disconfirmingFilled,
      lineageDropped,
      nearDuplicatesDropped,
    },
  };
}
