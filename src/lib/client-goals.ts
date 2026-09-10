export const CLIENT_GOAL_STATUSES = [
  "active",
  "achieved",
  "abandoned",
] as const;

export type ClientGoalStatus = (typeof CLIENT_GOAL_STATUSES)[number];

/** Static, fully-written class strings — Tailwind's JIT scans source text. */
export const CLIENT_GOAL_STATUS_LABELS: Record<ClientGoalStatus, string> = {
  active: "Active",
  achieved: "Achieved",
  abandoned: "Abandoned",
};

export const CLIENT_GOAL_STATUS_CHIP: Record<ClientGoalStatus, string> = {
  active: "border-brand-teal/40 text-brand-teal",
  achieved: "border-emerald-400/40 text-emerald-300",
  abandoned: "border-border text-muted-foreground/70",
};

/**
 * Both ends inclusive: a goal whose window ends today is still active today.
 * Excluding the end date would silently retire a goal on its final day, which
 * is the day someone is most likely to be looking at it.
 */
export function isGoalWindowActive(
  goal: { targetWindowStart: Date; targetWindowEnd: Date },
  now: Date,
): boolean {
  const t = now.getTime();
  return (
    t >= new Date(goal.targetWindowStart).getTime() &&
    t <= new Date(goal.targetWindowEnd).getTime()
  );
}
