/**
 * The public learning lane (C8.5 T85.3, folds in C7.8). Pure.
 *
 * The client's OWN public posts, with the engagement the platform publishes,
 * are a result it can learn from today, before anyone logs a creative: a post
 * "worked" when it beat the client's typical post (engagement index > 1,
 * measured against its own median, C3). Stats are per subject (a post on two
 * subjects counts once for each), faded by age and min-N gated like the
 * first-party loop.
 *
 * Kept apart from the first-party stats on purpose: these are public numbers
 * about the client's page, not its confirmed results. They never enter
 * featureStats() of the C6 loop and are always labelled "(public data)".
 */
import { isGenericTopic } from "./interest";
import { featureStats, type FeatureStat, type LearnedResult } from "./learning";

export type PublicPostSignal = {
  brandId: string | null;
  topic: string;
  channel: string;
  metric: string;
  signalKind: string;
  value: number;
  observedAt: Date;
  sourceUrl: string;
};

/** A post beating the client's typical engagement by this factor counts as "worked". */
export const PUBLIC_WIN_INDEX = 1;

export function publicLaneStats(
  signals: PublicPostSignal[],
  clientId: string,
  options: { now: Date; halfLifeDays: number; minN: number },
): FeatureStat[] {
  const own = signals.filter(
    // A field word ("analytical") is not a subject to learn about.
    (s) => s.brandId === clientId && s.signalKind === "interest" && s.metric === "engagement_index" && !isGenericTopic(s.topic),
  );
  const results: LearnedResult[] = own.map((s) => ({
    creativeId: `${s.sourceUrl}#${s.topic}`,
    verdict: s.value > PUBLIC_WIN_INDEX ? "worked" : "failed",
    confirmedAt: new Date(s.observedAt),
    features: { topic: s.topic },
  }));
  return featureStats(results, options);
}

/** "Waters'" / "Agilent's". */
export const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/** One plain line per stat, always labelled as public data. */
export function describePublicStat(s: FeatureStat, clientName: string, minN: number): string {
  if (s.status !== "ok") return `${possessive(clientName)} posts on ${s.value}: ${s.n} so far, needs ${minN} (public data)`;
  const pct = Math.round((s.worked / s.n) * 100);
  const lean = s.low > 0.5 ? "usually beat" : s.high < 0.5 ? "usually trail" : "are level with";
  return `${possessive(clientName)} posts on ${s.value} ${lean} its typical post: ${s.worked} of ${s.n} beat it (${pct}%) (public data)`;
}
