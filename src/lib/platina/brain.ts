export const DEFAULT_STALE_DAYS = 90;
export const DEFAULT_NEAR_DUPES = 3;
export const DEFAULT_COSINE = 0.92;

export type BrainChunk = {
  id: string;
  generation: number;
  confidence: number;
  lastRetrievedAt: Date | null;
  absorbedChunkIds: string[];
  contradicts?: boolean;
};

export type CompactionEligibility = {
  eligible: boolean;
  reasons: string[];
};

export function inheritedConfidence(parents: { confidence: number }[]): number {
  if (parents.length === 0) return 0;
  return Math.min(...parents.map((p) => p.confidence));
}

export function compactionEligible(
  group: BrainChunk[],
  now = new Date(),
  staleDays = DEFAULT_STALE_DAYS,
  nearDupes = DEFAULT_NEAR_DUPES,
): CompactionEligibility {
  const reasons: string[] = [];
  if (group.some((c) => c.generation !== 0)) {
    reasons.push("only gen-0 groups compact");
  }
  if (group.some((c) => c.contradicts)) {
    reasons.push("contradiction blocks compaction");
  }
  const stale = group.every((c) => {
    if (!c.lastRetrievedAt) return true;
    const age = (now.getTime() - c.lastRetrievedAt.getTime()) / 86_400_000;
    return age >= staleDays;
  });
  if (!stale) reasons.push("retrieved inside staleness window");
  if (group.length < nearDupes) reasons.push("not enough near-duplicates");

  return { eligible: reasons.length === 0, reasons };
}

export function compactedRecord(
  parents: BrainChunk[],
  content: string,
): {
  content: string;
  generation: 1;
  absorbedChunkIds: string[];
  confidence: number;
} {
  return {
    content,
    generation: 1,
    absorbedChunkIds: parents.map((p) => p.id),
    confidence: inheritedConfidence(parents),
  };
}

export function mayRewriteGen0(): false {
  return false;
}
