/** Pure month-grid math for the calendar screen. Weeks start Monday. */

export type CalendarDay = {
  /** YYYY-MM-DD in local time — the grouping key for slots. */
  key: string;
  dayOfMonth: number;
  inMonth: boolean;
};

export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Full weeks covering the given month (0-based), Monday-first. */
export function monthGrid(year: number, month: number): CalendarDay[][] {
  const first = new Date(year, month, 1);
  // getDay(): 0=Sun … 6=Sat → days back to the preceding Monday
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - lead);

  const weeks: CalendarDay[][] = [];
  const cursor = new Date(start);
  do {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({
        key: dayKey(cursor),
        dayOfMonth: cursor.getDate(),
        inMonth: cursor.getMonth() === month,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  } while (cursor.getMonth() === month);
  return weeks;
}

/** [from, to) datetime range covering exactly the grid monthGrid renders —
 *  lets the slots query fetch one visible month instead of full history. */
export function monthGridRange(
  year: number,
  month: number,
): { from: Date; to: Date } {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const from = new Date(year, month, 1 - lead);
  const weeks = monthGrid(year, month).length;
  const to = new Date(year, month, 1 - lead + weeks * 7);
  return { from, to };
}

/** "YYYY-MM-DD" + "HH:mm" → local Date, or null when either part is
 *  malformed or names an impossible calendar day (e.g. Feb 30). */
export function parseSlotDateTime(day: string, time: string): Date | null {
  const dayMatch = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/^(\d{2}):(\d{2})$/);
  if (!dayMatch || !timeMatch) return null;
  const [y, m, d] = dayMatch.slice(1).map(Number);
  const [h, min] = timeMatch.slice(1).map(Number);
  if (h > 23 || min > 59) return null;
  const date = new Date(y, m - 1, d, h, min);
  // Date rolls invalid days forward (Feb 30 → Mar 2) — reject those.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
}

export function groupByDay<T>(items: T[], at: (item: T) => Date) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = dayKey(at(item));
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}

export type PublishChecklistItem = {
  label: "Drafted" | "Approved" | "Scheduled";
  done: boolean;
};

/**
 * Derived, not stored — content.status already carries exactly these
 * milestones plus review/published. A slot only exists once content
 * reaches "approved" (scheduleContent enforces this), so Drafted and
 * Approved are always true for anything on the calendar; Scheduled
 * distinguishes "scheduled" from "published". The checklist is a
 * trust/audit trail, not the primary dynamic signal — overdue escalation
 * is that.
 */
export function publishChecklist(status: string): PublishChecklistItem[] {
  return [
    { label: "Drafted", done: true },
    {
      label: "Approved",
      done: status !== "draft" && status !== "review",
    },
    {
      label: "Scheduled",
      done: status === "scheduled" || status === "published",
    },
  ];
}

export function isOverdueSlot(
  scheduledFor: Date,
  status: string,
  now: Date = new Date(),
): boolean {
  return scheduledFor.getTime() < now.getTime() && status !== "published";
}
