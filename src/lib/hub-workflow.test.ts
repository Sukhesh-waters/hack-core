import { describe, expect, it } from "vitest";
import {
  doneFromHubTaskStatus,
  HUB_TASK_STATUS_ORDER,
  hubTaskStatusFromDone,
  isValidHubTaskTransition,
  nextHubTaskStatusesFrom,
  transitionsForHubTask,
  type HubTaskStatus,
} from "./hub-workflow";

describe("HUB_TASK_STATUS_ORDER", () => {
  it("is the two-node open/done view over the done boolean", () => {
    expect(HUB_TASK_STATUS_ORDER).toEqual(["open", "done"]);
  });
});

describe("transitionsForHubTask", () => {
  it("open moves to done (mark done)", () => {
    const transitions = transitionsForHubTask("open");
    expect(transitions).toEqual([{ to: "done", label: "Mark done" }]);
  });

  it("done moves to open (reopen)", () => {
    const transitions = transitionsForHubTask("done");
    expect(transitions).toEqual([{ to: "open", label: "Reopen" }]);
  });
});

describe("isValidHubTaskTransition", () => {
  it("allows marking an open task done", () => {
    expect(isValidHubTaskTransition("open", "done")).toBe(true);
  });

  it("allows reopening a done task", () => {
    expect(isValidHubTaskTransition("done", "open")).toBe(true);
  });

  it("rejects a no-op move to the same status", () => {
    expect(isValidHubTaskTransition("open", "open")).toBe(false);
    expect(isValidHubTaskTransition("done", "done")).toBe(false);
  });
});

describe("nextHubTaskStatusesFrom", () => {
  it("returns every status, never a subset", () => {
    for (const status of HUB_TASK_STATUS_ORDER) {
      const options = nextHubTaskStatusesFrom(status);
      expect(options.map((o) => o.status)).toEqual(HUB_TASK_STATUS_ORDER);
    }
  });

  it("marks the legal transition allowed with no reason", () => {
    const fromOpen = nextHubTaskStatusesFrom("open");
    const toDone = fromOpen.find((o) => o.status === "done");
    expect(toDone?.allowed).toBe(true);
    expect(toDone?.reason).toBeUndefined();

    const fromDone = nextHubTaskStatusesFrom("done");
    const toOpen = fromDone.find((o) => o.status === "open");
    expect(toOpen?.allowed).toBe(true);
    expect(toOpen?.reason).toBeUndefined();
  });

  it("marks the current status itself as disabled with a reason", () => {
    for (const status of HUB_TASK_STATUS_ORDER) {
      const options = nextHubTaskStatusesFrom(status);
      const self = options.find((o) => o.status === status);
      expect(self?.allowed).toBe(false);
      expect(self?.reason).toBeTruthy();
    }
  });

  it("property: never marks a transition allowed that isValidHubTaskTransition rejects, over every status pair", () => {
    for (const from of HUB_TASK_STATUS_ORDER) {
      const options = nextHubTaskStatusesFrom(from);
      for (const option of options) {
        const graphSaysLegal = isValidHubTaskTransition(
          from,
          option.status as HubTaskStatus,
        );
        if (option.allowed) {
          expect(graphSaysLegal).toBe(true);
        } else {
          expect(graphSaysLegal).toBe(false);
        }
      }
    }

    // Exhaustive over every (from, to) pair, not just what
    // nextHubTaskStatusesFrom happens to enumerate — a stronger form of the
    // same guarantee.
    for (const from of HUB_TASK_STATUS_ORDER) {
      for (const to of HUB_TASK_STATUS_ORDER) {
        const options = nextHubTaskStatusesFrom(from);
        const option = options.find((o) => o.status === to);
        expect(option).toBeDefined();
        expect(option?.allowed).toBe(isValidHubTaskTransition(from, to));
      }
    }
  });
});

describe("done <-> status view", () => {
  it("round-trips done through the status view", () => {
    expect(hubTaskStatusFromDone(false)).toBe("open");
    expect(hubTaskStatusFromDone(true)).toBe("done");
    expect(doneFromHubTaskStatus("open")).toBe(false);
    expect(doneFromHubTaskStatus("done")).toBe(true);
  });

  it("is a true inverse pair for every status", () => {
    for (const status of HUB_TASK_STATUS_ORDER) {
      expect(hubTaskStatusFromDone(doneFromHubTaskStatus(status))).toBe(status);
    }
  });
});
