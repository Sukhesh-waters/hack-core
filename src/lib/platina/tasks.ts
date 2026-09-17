/**
 * Solution work board logic (Slice 6). Pure. The board columns, the
 * event-anchored task template, and the blocker computation that final
 * approval consults.
 */

export const BOARD_COLUMNS = [
  "todo",
  "in_progress",
  "blocked",
  "review",
  "done",
] as const;

export type BoardStatus = (typeof BOARD_COLUMNS)[number];

export const BOARD_COLUMN_LABEL: Record<BoardStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  review: "Review",
  done: "Done",
};

export function isBoardStatus(value: string): value is BoardStatus {
  return (BOARD_COLUMNS as readonly string[]).includes(value);
}

export type BoardTask = {
  id: string;
  title: string;
  status: BoardStatus;
  claimsBlocked: boolean;
  dueDate?: Date | string | null;
  eventPhase?: "pre" | "at" | "post" | null;
};

/**
 * What blocks final approval: any task flagged claims-blocked that is not
 * done, or any task still on the board that is not done. An empty board does
 * not block — planning nothing is a choice; leaving work open is a blocker.
 */
export function blockersFor(tasks: BoardTask[]): {
  blocked: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const openClaims = tasks.filter((t) => t.claimsBlocked && t.status !== "done");
  if (openClaims.length > 0) {
    reasons.push(
      `${openClaims.length} claims-blocked task(s) open: ${openClaims
        .map((t) => t.title)
        .join("; ")}`,
    );
  }
  const openWork = tasks.filter((t) => t.status !== "done");
  if (openWork.length > 0) {
    reasons.push(`${openWork.length} task(s) not done`);
  }
  return { blocked: reasons.length > 0, reasons };
}

export type EventTemplateTask = {
  title: string;
  eventPhase: "pre" | "at" | "post";
  /** Days relative to the event anchor (negative = before). */
  offsetDays: number;
  claimsBlocked: boolean;
};

/**
 * The pre/at/post template for an event-anchored solution. Fixed and
 * deterministic — materialization is idempotent per campaign at the query
 * layer (existing template titles are detected, not duplicated).
 */
export function eventTaskTemplate(): EventTemplateTask[] {
  return [
    {
      title: "Finalize event messaging and talk tracks",
      eventPhase: "pre",
      offsetDays: -21,
      claimsBlocked: false,
    },
    {
      title: "Claims review of all event copy",
      eventPhase: "pre",
      offsetDays: -14,
      claimsBlocked: true,
    },
    {
      title: "Logistics, booth, and materials confirmed",
      eventPhase: "pre",
      offsetDays: -7,
      claimsBlocked: false,
    },
    {
      title: "Cover sessions and competitor presence; capture observations",
      eventPhase: "at",
      offsetDays: 0,
      claimsBlocked: false,
    },
    {
      title: "Record leads and conversations daily",
      eventPhase: "at",
      offsetDays: 1,
      claimsBlocked: false,
    },
    {
      title: "Import consented outcome data and link to the receipt",
      eventPhase: "post",
      offsetDays: 7,
      claimsBlocked: false,
    },
    {
      title: "Follow-up sequence to qualified leads",
      eventPhase: "post",
      offsetDays: 10,
      claimsBlocked: false,
    },
    {
      title: "Grade the decision receipt against measured outcomes",
      eventPhase: "post",
      offsetDays: 30,
      claimsBlocked: false,
    },
  ];
}

export function templateDueDate(anchor: Date, offsetDays: number): Date {
  return new Date(anchor.getTime() + offsetDays * 86_400_000);
}
