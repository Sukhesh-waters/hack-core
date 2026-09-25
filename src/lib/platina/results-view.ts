/**
 * What the Results page shows per creative (C6 L2). Pure.
 *
 * Status is the creative's place in the loop: no numbers yet -> measuring ->
 * review waiting -> learned (confirmed verdict). The comparison with the
 * client's usual post uses the same min-N gate as the review.
 */
import type { ReviewVerdict } from "@/db/platina-schema";
import { engagementRate, latestSnapshot, median, reviewDue, type MetricSnapshot, type ReviewCreative } from "./review";

export type CreativeStage = "no_numbers" | "measuring" | "review_waiting" | "learned";

export const STAGE_LABEL: Record<CreativeStage, string> = {
  no_numbers: "Add its numbers",
  measuring: "Measuring",
  review_waiting: "Review waiting",
  learned: "Learned",
};

export type CreativeSummary = {
  id: string;
  latest: MetricSnapshot | null;
  snapshots: number;
  rate: number | null;
  /** vs the client's usual post; null below min-N. */
  index: number | null;
  stage: CreativeStage;
  verdict: ReviewVerdict | null;
  /** Days until the review opens, while measuring. */
  reviewInDays: number | null;
};

type Creative = ReviewCreative & { brandId: string | null };
type Review = { creativeId: string; status: "draft" | "confirmed"; verdict: ReviewVerdict | null };

export function summariseCreatives(input: {
  creatives: Creative[];
  metrics: (MetricSnapshot & { creativeId: string })[];
  reviews: Review[];
  minN: number;
  reviewAfterDays: number;
  now: Date;
}): CreativeSummary[] {
  const snaps = new Map<string, MetricSnapshot[]>();
  for (const m of input.metrics) {
    const list = snaps.get(m.creativeId) ?? [];
    list.push(m);
    snaps.set(m.creativeId, list);
  }
  const reviews = new Map(input.reviews.map((r) => [r.creativeId, r]));
  const rates = new Map(input.creatives.map((c) => [c.id, engagementRate(latestSnapshot(snaps.get(c.id) ?? []))]));

  return input.creatives.map((c) => {
    const own = snaps.get(c.id) ?? [];
    const rate = rates.get(c.id) ?? null;
    const peers = input.creatives
      .filter((p) => p.id !== c.id && p.brandId === c.brandId)
      .map((p) => rates.get(p.id))
      .filter((r): r is number => typeof r === "number");
    const typical = peers.length >= input.minN ? median(peers) : null;
    const review = reviews.get(c.id);
    let stage: CreativeStage;
    if (review?.status === "confirmed") stage = "learned";
    else if (review) stage = "review_waiting";
    else if (own.length === 0) stage = "no_numbers";
    else stage = reviewDue({ creative: c, snapshots: own, reviewAfterDays: input.reviewAfterDays, hasReview: false, now: input.now })
      ? "review_waiting"
      : "measuring";
    const since = c.postedAt ?? c.createdAt;
    const waitMs = since.getTime() + input.reviewAfterDays * 86_400_000 - input.now.getTime();
    return {
      id: c.id,
      latest: latestSnapshot(own),
      snapshots: own.length,
      rate,
      index: rate !== null && typical ? rate / typical : null,
      stage,
      verdict: review?.status === "confirmed" ? review.verdict : null,
      reviewInDays: stage === "measuring" ? Math.max(1, Math.ceil(waitMs / 86_400_000)) : null,
    };
  });
}
