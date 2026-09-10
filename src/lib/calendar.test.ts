import { describe, expect, it } from "vitest";
import {
  dayKey,
  groupByDay,
  isOverdueSlot,
  monthGrid,
  monthGridRange,
  parseSlotDateTime,
  publishChecklist,
} from "./calendar";

describe("monthGrid", () => {
  it("July 2026: starts Mon Jun 29, ends Sun Aug 2, full weeks", () => {
    const weeks = monthGrid(2026, 6);
    expect(weeks).toHaveLength(5);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0][0]).toEqual({
      key: "2026-06-29",
      dayOfMonth: 29,
      inMonth: false,
    });
    expect(weeks[4][6]).toEqual({
      key: "2026-08-02",
      dayOfMonth: 2,
      inMonth: false,
    });
  });

  it("contains every day of the month exactly once", () => {
    const weeks = monthGrid(2026, 1); // Feb 2026
    const inMonth = weeks.flat().filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(28);
    expect(new Set(inMonth.map((d) => d.key)).size).toBe(28);
  });
});

describe("monthGridRange", () => {
  it("July 2026: [Mon Jun 29, Mon Aug 3) — covers the rendered grid exactly", () => {
    const { from, to } = monthGridRange(2026, 6);
    expect(dayKey(from)).toBe("2026-06-29");
    expect(dayKey(to)).toBe("2026-08-03"); // exclusive upper bound
  });

  it("range spans exactly the grid's day count", () => {
    for (const [y, m] of [
      [2026, 1], // Feb, 28 days
      [2026, 6],
      [2024, 1], // leap Feb
      [2026, 11], // Dec, year wrap
    ] as const) {
      const days = monthGrid(y, m).flat().length;
      const { from, to } = monthGridRange(y, m);
      const spanDays = Math.round(
        (to.getTime() - from.getTime()) / 86_400_000,
      );
      expect(spanDays).toBe(days);
    }
  });

  it("every in-month slot datetime falls inside [from, to)", () => {
    const { from, to } = monthGridRange(2026, 6);
    const lastSlot = new Date(2026, 7, 2, 23, 59); // Aug 2, last grid day
    const firstSlot = new Date(2026, 5, 29, 0, 0); // Jun 29, first grid day
    expect(firstSlot >= from && firstSlot < to).toBe(true);
    expect(lastSlot >= from && lastSlot < to).toBe(true);
  });
});

describe("parseSlotDateTime", () => {
  it("combines day and time into a local Date", () => {
    const d = parseSlotDateTime("2026-07-15", "09:30");
    expect(d).toEqual(new Date(2026, 6, 15, 9, 30));
  });

  it("rejects malformed inputs", () => {
    expect(parseSlotDateTime("2026-7-15", "09:30")).toBeNull();
    expect(parseSlotDateTime("2026-07-15", "9:30")).toBeNull();
    expect(parseSlotDateTime("", "09:30")).toBeNull();
    expect(parseSlotDateTime("2026-07-15", "")).toBeNull();
    expect(parseSlotDateTime("2026-07-15", "24:00")).toBeNull();
    expect(parseSlotDateTime("2026-07-15", "10:60")).toBeNull();
  });

  it("rejects impossible calendar days instead of rolling them over", () => {
    expect(parseSlotDateTime("2026-02-30", "10:00")).toBeNull();
    expect(parseSlotDateTime("2026-13-01", "10:00")).toBeNull();
    expect(parseSlotDateTime("2024-02-29", "10:00")).not.toBeNull(); // leap
  });
});

describe("groupByDay", () => {
  it("groups items under their local-date key", () => {
    const a = { at: new Date(2026, 6, 10, 9, 0) };
    const b = { at: new Date(2026, 6, 10, 18, 30) };
    const c = { at: new Date(2026, 6, 11, 8, 0) };
    const grouped = groupByDay([a, b, c], (x) => x.at);
    expect(grouped.get("2026-07-10")).toEqual([a, b]);
    expect(grouped.get("2026-07-11")).toEqual([c]);
  });

  it("dayKey pads month and day", () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("publishChecklist", () => {
  it("draft: only Drafted is done", () => {
    expect(publishChecklist("draft")).toEqual([
      { label: "Drafted", done: true },
      { label: "Approved", done: false },
      { label: "Scheduled", done: false },
    ]);
  });

  it("scheduled: all three done", () => {
    const items = publishChecklist("scheduled");
    expect(items.every((i) => i.done)).toBe(true);
  });

  it("published: all three done", () => {
    const items = publishChecklist("published");
    expect(items.every((i) => i.done)).toBe(true);
  });

  it("review: Drafted done, Approved and Scheduled not", () => {
    expect(publishChecklist("review")).toEqual([
      { label: "Drafted", done: true },
      { label: "Approved", done: false },
      { label: "Scheduled", done: false },
    ]);
  });
});

describe("isOverdueSlot", () => {
  const now = new Date("2026-07-11T12:00:00Z");

  it("past date, not published → overdue", () => {
    expect(
      isOverdueSlot(new Date("2026-07-10T12:00:00Z"), "scheduled", now),
    ).toBe(true);
  });

  it("past date, published → not overdue", () => {
    expect(
      isOverdueSlot(new Date("2026-07-10T12:00:00Z"), "published", now),
    ).toBe(false);
  });

  it("future date → not overdue", () => {
    expect(
      isOverdueSlot(new Date("2026-07-12T12:00:00Z"), "scheduled", now),
    ).toBe(false);
  });
});
