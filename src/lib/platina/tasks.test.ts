import { describe, expect, it } from "vitest";
import {
  blockersFor,
  eventTaskTemplate,
  isBoardStatus,
  templateDueDate,
  type BoardTask,
} from "./tasks";

const task = (overrides: Partial<BoardTask>): BoardTask => ({
  id: crypto.randomUUID(),
  title: "task",
  status: "todo",
  claimsBlocked: false,
  ...overrides,
});

describe("board", () => {
  it("recognizes exactly the five columns", () => {
    for (const s of ["todo", "in_progress", "blocked", "review", "done"]) {
      expect(isBoardStatus(s)).toBe(true);
    }
    expect(isBoardStatus("archived")).toBe(false);
  });
});

describe("blockersFor", () => {
  it("an empty board does not block", () => {
    expect(blockersFor([]).blocked).toBe(false);
  });

  it("open claims-blocked tasks block, named", () => {
    const result = blockersFor([
      task({ status: "in_progress", claimsBlocked: true, title: "claims review" }),
    ]);
    expect(result.blocked).toBe(true);
    expect(result.reasons[0]).toContain("claims review");
  });

  it("any undone task blocks final approval", () => {
    expect(blockersFor([task({ status: "review" })]).blocked).toBe(true);
    expect(blockersFor([task({ status: "done" })]).blocked).toBe(false);
  });
});

describe("eventTaskTemplate", () => {
  it("covers pre, at, and post phases", () => {
    const phases = new Set(eventTaskTemplate().map((t) => t.eventPhase));
    expect(phases).toEqual(new Set(["pre", "at", "post"]));
  });

  it("pre-event tasks land before the anchor; post after", () => {
    const anchor = new Date("2026-11-10T00:00:00Z");
    for (const t of eventTaskTemplate()) {
      const due = templateDueDate(anchor, t.offsetDays);
      if (t.eventPhase === "pre") expect(due.getTime()).toBeLessThan(anchor.getTime());
      if (t.eventPhase === "post") expect(due.getTime()).toBeGreaterThan(anchor.getTime());
    }
  });

  it("the claims review task is claims-blocking", () => {
    const claims = eventTaskTemplate().find((t) => t.title.includes("Claims"));
    expect(claims?.claimsBlocked).toBe(true);
  });
});
