/**
 * Event readiness computation (Slice 7). Pure. Answers "are we ready for
 * this event?" with facts: days to the anchor, per-phase completion, missing
 * phases, overdue tasks. No score is fabricated — the panel lists gaps and
 * lets a human judge.
 */

export type ReadinessTask = {
  title: string;
  status: string;
  eventPhase: "pre" | "at" | "post" | null;
  dueDate?: Date | string | null;
};

export type PhaseReadiness = {
  phase: "pre" | "at" | "post";
  total: number;
  done: number;
};

export type Readiness = {
  hasAnchor: boolean;
  daysToEvent: number | null;
  /** The event date has passed. */
  postEvent: boolean;
  phases: PhaseReadiness[];
  /** Phases with zero tasks — work nobody has planned. */
  missingPhases: ("pre" | "at" | "post")[];
  overdueTasks: string[];
  gaps: string[];
};

export function readinessFor(
  input: {
    eventAnchor: Date | string | null;
    eventLabel?: string | null;
    tasks: ReadinessTask[];
  },
  now = new Date(),
): Readiness {
  const anchor = input.eventAnchor ? new Date(input.eventAnchor) : null;
  const daysToEvent = anchor
    ? Math.ceil((anchor.getTime() - now.getTime()) / 86_400_000)
    : null;
  const postEvent = daysToEvent !== null && daysToEvent < 0;

  const phases: PhaseReadiness[] = (["pre", "at", "post"] as const).map(
    (phase) => {
      const inPhase = input.tasks.filter((t) => t.eventPhase === phase);
      return {
        phase,
        total: inPhase.length,
        done: inPhase.filter((t) => t.status === "done").length,
      };
    },
  );

  const missingPhases = phases
    .filter((p) => p.total === 0)
    .map((p) => p.phase);

  const overdueTasks = input.tasks
    .filter(
      (t) =>
        t.status !== "done" &&
        t.dueDate &&
        new Date(t.dueDate).getTime() < now.getTime(),
    )
    .map((t) => t.title);

  const gaps: string[] = [];
  if (!anchor) {
    gaps.push("No event anchor set — the calendar and template need a date.");
  }
  for (const phase of missingPhases) {
    gaps.push(
      `No ${phase === "pre" ? "pre-event" : phase === "at" ? "at-event" : "post-event"} work planned.`,
    );
  }
  if (overdueTasks.length > 0) {
    gaps.push(`${overdueTasks.length} task(s) overdue: ${overdueTasks.join("; ")}`);
  }
  if (postEvent) {
    const post = phases.find((p) => p.phase === "post")!;
    if (post.total > 0 && post.done < post.total) {
      gaps.push(
        "The event has passed — the post-event measurement checklist is not complete.",
      );
    }
  }

  return {
    hasAnchor: anchor !== null,
    daysToEvent,
    postEvent,
    phases,
    missingPhases,
    overdueTasks,
    gaps,
  };
}
