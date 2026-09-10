export type PlanSlotAttribution = {
  slotKey: string;
  contentId: string;
  title: string;
  status: string;
  isPublished: boolean;
  publishedDate?: Date | null;
  metrics?: {
    engagementRate?: number;
    reach?: number;
    likes?: number;
    comments?: number;
    score?: number;
  };
};

export type PlanPerformanceRollup = {
  totalPlanned: number;
  totalPublished: number;
  publishRate: number;
  avgEngagementRate: number | null;
  slots: PlanSlotAttribution[];
  topPerformingSlot: PlanSlotAttribution | null;
};

/**
 * Aggregates post and content measurement back into the originating plan slots
 * to evaluate whether an editorial plan delivered target performance.
 */
export function calculatePlanAttribution(
  slots: Array<{
    slotKey: string;
    contentId: string;
    title: string;
    status: string;
    publishedDate?: Date | null;
    metrics?: {
      engagementRate?: number;
      reach?: number;
      likes?: number;
      comments?: number;
      score?: number;
    };
  }>,
): PlanPerformanceRollup {
  if (slots.length === 0) {
    return {
      totalPlanned: 0,
      totalPublished: 0,
      publishRate: 0,
      avgEngagementRate: null,
      slots: [],
      topPerformingSlot: null,
    };
  }

  const enrichedSlots: PlanSlotAttribution[] = slots.map((s) => ({
    ...s,
    isPublished: s.status === "published" || Boolean(s.publishedDate),
  }));

  const published = enrichedSlots.filter((s) => s.isPublished);
  const scoredPublished = published.filter(
    (s) => s.metrics?.engagementRate !== undefined && s.metrics.engagementRate !== null,
  );

  const avgEngagementRate =
    scoredPublished.length > 0
      ? scoredPublished.reduce(
          (sum, s) => sum + (s.metrics?.engagementRate ?? 0),
          0,
        ) / scoredPublished.length
      : null;

  let topPerformingSlot: PlanSlotAttribution | null = null;
  let maxScore = -1;

  for (const s of scoredPublished) {
    const score = s.metrics?.engagementRate ?? s.metrics?.score ?? 0;
    if (score > maxScore) {
      maxScore = score;
      topPerformingSlot = s;
    }
  }

  const publishRate = (published.length / enrichedSlots.length) * 100;

  return {
    totalPlanned: enrichedSlots.length,
    totalPublished: published.length,
    publishRate: Number(publishRate.toFixed(1)),
    avgEngagementRate:
      avgEngagementRate !== null ? Number(avgEngagementRate.toFixed(3)) : null,
    slots: enrichedSlots,
    topPerformingSlot,
  };
}
