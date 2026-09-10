export const STALE_AFTER_DAYS = 7;

export type Freshness =
  | { status: "never" }
  | { status: "fresh" | "stale"; ageDays: number };

/** Constitution: KB stale → flag it, don't silently serve it. */
export function getFreshness(
  lastPullAt: Date | null,
  now: Date = new Date(),
): Freshness {
  if (!lastPullAt) return { status: "never" };
  const ageDays = Math.floor(
    (now.getTime() - lastPullAt.getTime()) / 86_400_000,
  );
  return { status: ageDays > STALE_AFTER_DAYS ? "stale" : "fresh", ageDays };
}

/** Chunk compaction helper: identifies near-duplicate text chunks (word overlap >= threshold) to keep context windows lean. */
export function compactSimilarChunks(chunks: string[], overlapThreshold = 0.85): string[] {
  const unique: string[] = [];
  for (const chunk of chunks) {
    const isDuplicate = unique.some((existing) => {
      const words1 = new Set(existing.toLowerCase().split(/\s+/));
      const words2 = new Set(chunk.toLowerCase().split(/\s+/));
      const intersection = Array.from(words1).filter((w) => words2.has(w)).length;
      const union = new Set([...words1, ...words2]).size;
      return union > 0 && intersection / union >= overlapThreshold;
    });
    if (!isDuplicate) {
      unique.push(chunk);
    }
  }
  return unique;
}
