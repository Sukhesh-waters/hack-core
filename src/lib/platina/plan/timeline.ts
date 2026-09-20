import type { PlanDoc } from "@/db/platina-schema";

export type ChannelKind =
  | "social"
  | "email"
  | "video"
  | "paid"
  | "event"
  | "press"
  | "community"
  | "web"
  | "other";

// Order matters: the first match wins (e.g. "video ads" reads as video).
const KEYWORDS: Array<[ChannelKind, RegExp]> = [
  ["email", /e-?mail|newsletter|crm|drip/i],
  ["video", /video|youtube|reel|tiktok|stream/i],
  ["paid", /paid|\bads?\b|ppc|\bsem\b|sponsor|display|retarget/i],
  ["event", /event|webinar|conference|summit|meetup/i],
  ["press", /\bpr\b|press|media|journalist|announcement/i],
  ["community", /community|influencer|partner|creator|ambassador|referral/i],
  ["social", /social|instagram|linkedin|twitter|\bx\b|facebook|threads|pinterest/i],
  ["web", /web|site|landing|seo|blog|content/i],
];

/** Coarse channel category, used to pick an icon and colour for the roadmap. */
export function channelKind(channel: string): ChannelKind {
  for (const [kind, pattern] of KEYWORDS) {
    if (pattern.test(channel)) return kind;
  }
  return "other";
}

export type TimelineRow = {
  id: string;
  name: string;
  channel: string;
  message: string;
  startDay: number;
  endDay: number;
  /** Position and size as percentages of the whole timeline width. */
  leftPct: number;
  widthPct: number;
};

export type Timeline = {
  totalDays: number;
  ticks: Array<{ day: number; leftPct: number }>;
  rows: TimelineRow[];
};

const MIN_BAR_PCT = 3;
const TARGET_TICKS = 8;
const NICE_STEPS = [1, 2, 5, 7, 10, 14, 15, 20, 30, 45, 60, 90];

/** Pure layout for the visual roadmap: one row per phase on a shared day axis. */
export function layoutTimeline(plan: PlanDoc): Timeline {
  const totalDays = Math.max(
    1,
    plan.totalDays,
    ...plan.phases.map((p) => p.endDay),
  );
  const pct = (days: number) => (days / totalDays) * 100;

  const rows = plan.phases.map((phase) => {
    const leftPct = pct(phase.startDay - 1);
    const widthPct = Math.min(
      Math.max(pct(phase.endDay - phase.startDay + 1), MIN_BAR_PCT),
      100 - leftPct,
    );
    return { ...phase, leftPct, widthPct };
  });

  const step =
    NICE_STEPS.find((s) => totalDays / s <= TARGET_TICKS) ??
    NICE_STEPS[NICE_STEPS.length - 1];
  const days = [1];
  for (let day = step; day <= totalDays; day += step) {
    if (day > 1) days.push(day);
  }
  const ticks = days.map((day) => ({ day, leftPct: pct(day - 1) }));

  return { totalDays, ticks, rows };
}
