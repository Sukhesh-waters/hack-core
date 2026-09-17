/**
 * Reciprocal rank fusion (R4.4). Combines the vector ranking and the lexical
 * (BM25) ranking into one list per plane — exact-string hits (model numbers,
 * method codes) that pure vector search misses get their rank contribution,
 * and vice versa. Planes A and C only; Plane B is structurally unsearchable.
 */

export type RankedItem = { id: string; score: number };

export type FusedItem<T> = { item: T; score: number };

/**
 * RRF with the standard k=60. Items absent from a list simply get no
 * contribution from it. The `scoreOf` callback maps a fused score into the
 * caller's comparable range.
 */
export function reciprocalRankFusion<T extends { id: string }>(
  rankings: { items: T[]; weight?: number }[],
  rrfK = 60,
): FusedItem<T>[] {
  const byId = new Map<string, { item: T; rrf: number }>();
  for (const { items, weight = 1 } of rankings) {
    items.forEach((item, index) => {
      const entry = byId.get(item.id) ?? { item, rrf: 0 };
      entry.rrf += weight / (rrfK + index + 1);
      byId.set(item.id, entry);
    });
  }
  return [...byId.values()]
    .map(({ item, rrf }) => ({ item, score: rrf }))
    .sort((a, b) => b.score - a.score);
}
