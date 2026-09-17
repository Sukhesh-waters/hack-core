import { describe, expect, it } from "vitest";
import { readinessFor, type ReadinessTask } from "./readiness";

const NOW = new Date("2026-09-17T12:00:00Z");
const task = (overrides: Partial<ReadinessTask>): ReadinessTask => ({
  title: "task",
  status: "todo",
  eventPhase: null,
  dueDate: null,
  ...overrides,
});

describe("readinessFor", () => {
  it("no anchor: honest empty state with the anchor gap named", () => {
    const r = readinessFor({ eventAnchor: null, tasks: [] }, NOW);
    expect(r.hasAnchor).toBe(false);
    expect(r.daysToEvent).toBeNull();
    expect(r.gaps[0]).toMatch(/No event anchor/);
    expect(r.missingPhases).toEqual(["pre", "at", "post"]);
  });

  it("computes days to the event and per-phase completion", () => {
    const anchor = new Date("2026-10-01T00:00:00Z");
    const r = readinessFor(
      {
        eventAnchor: anchor,
        tasks: [
          task({ eventPhase: "pre", status: "done" }),
          task({ eventPhase: "pre", status: "in_progress" }),
          task({ eventPhase: "at", status: "todo" }),
        ],
      },
      NOW,
    );
    expect(r.daysToEvent).toBe(14);
    expect(r.postEvent).toBe(false);
    expect(r.phases.find((p) => p.phase === "pre")).toEqual({
      phase: "pre",
      total: 2,
      done: 1,
    });
    expect(r.missingPhases).toEqual(["post"]);
    expect(r.gaps).toEqual(
      expect.arrayContaining([expect.stringContaining("post-event")]),
    );
  });

  it("names overdue tasks", () => {
    const r = readinessFor(
      {
        eventAnchor: new Date("2026-10-01T00:00:00Z"),
        tasks: [
          task({
            title: "book booth",
            status: "in_progress",
            dueDate: new Date("2026-09-01T00:00:00Z"),
          }),
          task({ title: "done thing", status: "done", dueDate: new Date("2026-09-01T00:00:00Z") }),
        ],
      },
      NOW,
    );
    expect(r.overdueTasks).toEqual(["book booth"]);
    expect(r.gaps.some((g) => g.includes("book booth"))).toBe(true);
  });

  it("post-event with an incomplete measurement checklist is a gap", () => {
    const r = readinessFor(
      {
        eventAnchor: new Date("2026-09-01T00:00:00Z"),
        tasks: [task({ eventPhase: "post", status: "todo" })],
      },
      NOW,
    );
    expect(r.postEvent).toBe(true);
    expect(r.gaps.some((g) => g.includes("measurement checklist"))).toBe(true);
  });

  it("post-event with the checklist complete has no measurement gap", () => {
    const r = readinessFor(
      {
        eventAnchor: new Date("2026-09-01T00:00:00Z"),
        tasks: [task({ eventPhase: "post", status: "done" })],
      },
      NOW,
    );
    expect(r.gaps.some((g) => g.includes("measurement checklist"))).toBe(false);
  });
});
