/**
 * Bounded reranking (R4.3). Bi-encoder similarity optimizes topical
 * resemblance, not answer relevance — so the fused candidate set gets one
 * batched scoring pass through the model router (inside its budget
 * enforcement), then the final set is taken by rerank score.
 *
 * Degradation is honest: a router failure returns the fused order untouched
 * with `reranked: false`. Never a fabricated score.
 */
import { routeAI } from "@/lib/ai/router";

export type RerankCandidate = { id: string; content: string };

export type RerankResult<T extends RerankCandidate> = {
  items: T[];
  reranked: boolean;
};

const MAX_CANDIDATES = 20;
const MAX_CONTENT_CHARS = 400;

export async function rerankCandidates<T extends RerankCandidate>(
  topic: string,
  candidates: T[],
  take: number,
): Promise<RerankResult<T>> {
  if (candidates.length <= 1) {
    return { items: candidates.slice(0, take), reranked: false };
  }
  const bounded = candidates.slice(0, MAX_CANDIDATES);
  try {
    const listing = bounded
      .map(
        (c, i) =>
          `[${i}] ${c.content.slice(0, MAX_CONTENT_CHARS).replace(/\n/g, " ")}`,
      )
      .join("\n");
    const raw = await routeAI({
      kind: "chat",
      json: true,
      system:
        "You score retrieval candidates for relevance to the operator's question. " +
        'Reply JSON {"scores": number[]} — one 0..1 relevance score per [index], ' +
        "same order, no commentary.",
      prompt: `Question: ${topic.slice(0, 500)}\n\nCandidates:\n${listing}`,
    });
    const parsed = JSON.parse(raw) as { scores?: unknown };
    const scores = Array.isArray(parsed.scores) ? parsed.scores : null;
    if (!scores || scores.length !== bounded.length) {
      return { items: bounded.slice(0, take), reranked: false };
    }
    const scored = bounded
      .map((candidate, i) => ({
        candidate,
        score: Math.min(1, Math.max(0, Number(scores[i]) || 0)),
      }))
      .sort((a, b) => b.score - a.score)
      .map((s) => s.candidate);
    return { items: scored.slice(0, take), reranked: true };
  } catch {
    return { items: bounded.slice(0, take), reranked: false };
  }
}
