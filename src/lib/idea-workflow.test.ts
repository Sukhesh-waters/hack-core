import { describe, expect, it } from "vitest";
import {
  IDEA_STATUS_ORDER,
  isValidIdeaTransition,
  nextIdeaStatusesFrom,
  transitionsForIdea,
  type IdeaStatus,
} from "./idea-workflow";

describe("IDEA_STATUS_ORDER", () => {
  it("matches the pgEnum order", () => {
    expect(IDEA_STATUS_ORDER).toEqual(["new", "drafted", "archived"]);
  });
});

describe("transitionsForIdea", () => {
  it("new forks to drafted (accept) and archived (reject)", () => {
    const transitions = transitionsForIdea("new");
    expect(transitions).toHaveLength(2);
    expect(transitions.map((t) => t.to).sort()).toEqual([
      "archived",
      "drafted",
    ]);
  });

  it("drafted allows moving back to new (Un-draft)", () => {
    const transitions = transitionsForIdea("drafted");
    expect(transitions).toEqual([{ to: "new", label: "Un-draft" }]);
  });

  it("archived allows moving back to new (Restore)", () => {
    const transitions = transitionsForIdea("archived");
    expect(transitions).toEqual([{ to: "new", label: "Restore" }]);
  });
});

describe("isValidIdeaTransition", () => {
  it("allows accept and reject from new", () => {
    expect(isValidIdeaTransition("new", "drafted")).toBe(true);
    expect(isValidIdeaTransition("new", "archived")).toBe(true);
  });

  it("allows reverse transitions to new from drafted and archived", () => {
    expect(isValidIdeaTransition("drafted", "new")).toBe(true);
    expect(isValidIdeaTransition("archived", "new")).toBe(true);
  });

  it("rejects cross-moves between drafted and archived", () => {
    expect(isValidIdeaTransition("drafted", "archived")).toBe(false);
    expect(isValidIdeaTransition("archived", "drafted")).toBe(false);
  });

  it("rejects a no-op move to the same status", () => {
    expect(isValidIdeaTransition("new", "new")).toBe(false);
    expect(isValidIdeaTransition("drafted", "drafted")).toBe(false);
  });
});

describe("nextIdeaStatusesFrom", () => {
  it("returns every status, never a subset", () => {
    for (const status of IDEA_STATUS_ORDER) {
      const options = nextIdeaStatusesFrom(status);
      expect(options.map((o) => o.status)).toEqual(IDEA_STATUS_ORDER);
    }
  });

  it("marks legal transitions from new allowed with no reason", () => {
    const options = nextIdeaStatusesFrom("new");
    const drafted = options.find((o) => o.status === "drafted");
    const archived = options.find((o) => o.status === "archived");
    expect(drafted?.allowed).toBe(true);
    expect(drafted?.reason).toBeUndefined();
    expect(archived?.allowed).toBe(true);
    expect(archived?.reason).toBeUndefined();
  });

  it("carries the semantic verb for each legal move from new", () => {
    const options = nextIdeaStatusesFrom("new");
    expect(options.find((o) => o.status === "drafted")?.actionLabel).toBe(
      "Accept",
    );
    expect(options.find((o) => o.status === "archived")?.actionLabel).toBe(
      "Reject",
    );
  });

  it("omits actionLabel for disallowed destinations", () => {
    const options = nextIdeaStatusesFrom("new");
    const self = options.find((o) => o.status === "new");
    expect(self?.actionLabel).toBeUndefined();
  });

  it("marks the current status itself as disabled with a reason", () => {
    const options = nextIdeaStatusesFrom("new");
    const self = options.find((o) => o.status === "new");
    expect(self?.allowed).toBe(false);
    expect(self?.reason).toBeTruthy();
  });

  it("drafted permits reverse transition to new with Un-draft label", () => {
    const options = nextIdeaStatusesFrom("drafted");
    const toNew = options.find((o) => o.status === "new");
    expect(toNew?.allowed).toBe(true);
    expect(toNew?.actionLabel).toBe("Un-draft");
  });

  it("archived permits reverse transition to new with Restore label", () => {
    const options = nextIdeaStatusesFrom("archived");
    const toNew = options.find((o) => o.status === "new");
    expect(toNew?.allowed).toBe(true);
    expect(toNew?.actionLabel).toBe("Restore");
  });

  it("property: never marks a transition allowed that isValidIdeaTransition rejects, over every status pair", () => {
    for (const from of IDEA_STATUS_ORDER) {
      const options = nextIdeaStatusesFrom(from);
      for (const option of options) {
        const graphSaysLegal = isValidIdeaTransition(
          from,
          option.status as IdeaStatus,
        );
        if (option.allowed) {
          expect(graphSaysLegal).toBe(true);
        } else {
          expect(graphSaysLegal).toBe(false);
        }
      }
    }

    // Exhaustive over every (from, to) pair, not just what nextIdeaStatusesFrom
    // happens to enumerate — a stronger form of the same guarantee.
    for (const from of IDEA_STATUS_ORDER) {
      for (const to of IDEA_STATUS_ORDER) {
        const options = nextIdeaStatusesFrom(from);
        const option = options.find((o) => o.status === to);
        expect(option).toBeDefined();
        expect(option?.allowed).toBe(isValidIdeaTransition(from, to));
      }
    }
  });
});
