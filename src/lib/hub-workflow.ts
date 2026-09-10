/**
 * Status graph for hub tasks. Mirrors the shape of `src/lib/idea-workflow.ts`
 * on purpose — same "labels + chip classes + transition table + allowed-with-
 * reason lookup" pattern, so the generic `StatusMenu` from
 * `transition-menu.tsx` can back both surfaces without a bespoke widget per
 * screen.
 *
 * `hubTasks` has no `status` column by design (see CLAUDE.md scope note) —
 * only a `done: boolean`. `HubTaskStatus` is a view over that boolean, not a
 * new persisted field: "open" is `done = false`, "done" is `done = true`.
 * `hubTaskStatusFromDone` / `doneFromHubTaskStatus` are the two directions of
 * that mapping, so nothing else needs to know the boolean is the source of
 * truth.
 */

export type HubTaskStatus = "open" | "done";

/** Single source of truth for status order. */
export const HUB_TASK_STATUS_ORDER: HubTaskStatus[] = ["open", "done"];

export const HUB_TASK_STATUS_LABELS: Record<HubTaskStatus, string> = {
  open: "Open",
  done: "Done",
};

/**
 * Static, fully-written Tailwind class strings (JIT scans source text, so
 * nothing here may be template-built).
 */
export const HUB_TASK_STATUS_CHIP_CLASSES: Record<HubTaskStatus, string> = {
  open: "bg-accent text-muted-foreground",
  done: "bg-brand-teal/15 text-brand-teal",
};

export type HubTaskTransition = {
  to: HubTaskStatus;
  label: string;
};

/**
 * A two-node graph, not a line: open and done can each move to the other
 * (mark done / reopen). The only thing this menu ever refuses is a no-op
 * move to the status a task is already in.
 */
const TRANSITIONS: Record<HubTaskStatus, HubTaskTransition[]> = {
  open: [{ to: "done", label: "Mark done" }],
  done: [{ to: "open", label: "Reopen" }],
};

export function transitionsForHubTask(status: HubTaskStatus): HubTaskTransition[] {
  return TRANSITIONS[status];
}

export function isValidHubTaskTransition(
  from: HubTaskStatus,
  to: HubTaskStatus,
): boolean {
  return TRANSITIONS[from].some((t) => t.to === to);
}

export type NextHubTaskStatusOption = {
  status: HubTaskStatus;
  allowed: boolean;
  /** Present whenever allowed is false — why this move isn't on the table. */
  reason?: string;
};

/**
 * Every hub task status, flagged for whether `current` can legally move to
 * it right now. Illegal destinations are never omitted, they're returned
 * disabled with a short reason — a greyed transition teaches the workflow,
 * a hidden one just confuses. `allowed` is always derived from
 * `isValidHubTaskTransition`, so this can never offer a move the transition
 * graph rejects.
 */
export function nextHubTaskStatusesFrom(
  current: HubTaskStatus,
): NextHubTaskStatusOption[] {
  return HUB_TASK_STATUS_ORDER.map((status) => {
    if (status === current) {
      return { status, allowed: false, reason: "this is the current status" };
    }
    if (isValidHubTaskTransition(current, status)) {
      return { status, allowed: true };
    }
    return {
      status,
      allowed: false,
      reason: `not reachable from ${HUB_TASK_STATUS_LABELS[current].toLowerCase()}`,
    };
  });
}

/** View: the persisted `done` boolean as a status. */
export function hubTaskStatusFromDone(done: boolean): HubTaskStatus {
  return done ? "done" : "open";
}

/** Inverse view: a status back to the persisted `done` boolean. */
export function doneFromHubTaskStatus(status: HubTaskStatus): boolean {
  return status === "done";
}
