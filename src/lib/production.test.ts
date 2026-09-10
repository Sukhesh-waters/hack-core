import { describe, expect, it } from "vitest";
import {
  isValidTransition,
  nextStagesFrom,
  PRODUCTION_STAGE_ORDER,
  transitionsFor,
  type ProductionStage,
} from "./production";

describe("PRODUCTION_STAGE_ORDER", () => {
  it("matches the spec column order", () => {
    expect(PRODUCTION_STAGE_ORDER).toEqual([
      "brief",
      "in_progress",
      "internal_review",
      "revision",
      "done",
    ]);
  });
});

describe("transitionsFor", () => {
  it("brief has a single forward transition", () => {
    const transitions = transitionsFor("brief");
    expect(transitions).toHaveLength(1);
    expect(transitions[0].to).toBe("in_progress");
    expect(transitions[0].incrementsRevision).toBe(false);
  });

  it("internal_review has two exits, only send-back increments revision", () => {
    const transitions = transitionsFor("internal_review");
    expect(transitions).toHaveLength(2);
    const sendBack = transitions.find((t) => t.to === "revision");
    const done = transitions.find((t) => t.to === "done");
    expect(sendBack?.incrementsRevision).toBe(true);
    expect(done?.incrementsRevision).toBe(false);
  });

  it("revision's only exit is back to internal_review", () => {
    const transitions = transitionsFor("revision");
    expect(transitions).toHaveLength(1);
    expect(transitions[0].to).toBe("internal_review");
  });

  it("done's only exit is reopening to in_progress", () => {
    const transitions = transitionsFor("done");
    expect(transitions).toHaveLength(1);
    expect(transitions[0].to).toBe("in_progress");
    expect(transitions[0].label).toBe("Reopen");
    expect(transitions[0].incrementsRevision).toBe(false);
  });
});

describe("isValidTransition", () => {
  it("allows the resubmit loop", () => {
    expect(isValidTransition("revision", "internal_review")).toBe(true);
  });

  it("rejects skipping stages", () => {
    expect(isValidTransition("brief", "done")).toBe(false);
    expect(isValidTransition("brief", "internal_review")).toBe(false);
  });

  it("rejects moving backward except the revision loop and reopen", () => {
    expect(isValidTransition("in_progress", "brief")).toBe(false);
    expect(isValidTransition("done", "internal_review")).toBe(false);
  });

  it("allows reopening done work", () => {
    expect(isValidTransition("done", "in_progress")).toBe(true);
  });
});

describe("nextStagesFrom", () => {
  it("returns every stage, never a subset", () => {
    for (const stage of PRODUCTION_STAGE_ORDER) {
      const options = nextStagesFrom(stage);
      expect(options.map((o) => o.stage)).toEqual(PRODUCTION_STAGE_ORDER);
    }
  });

  it("marks legal transitions allowed with no reason", () => {
    const options = nextStagesFrom("internal_review");
    const done = options.find((o) => o.stage === "done");
    const revision = options.find((o) => o.stage === "revision");
    expect(done?.allowed).toBe(true);
    expect(done?.reason).toBeUndefined();
    expect(revision?.allowed).toBe(true);
    expect(revision?.reason).toBeUndefined();
  });

  it("marks illegal transitions disabled with a human reason", () => {
    const options = nextStagesFrom("in_progress");
    const brief = options.find((o) => o.stage === "brief");
    const done = options.find((o) => o.stage === "done");
    expect(brief?.allowed).toBe(false);
    expect(brief?.reason).toMatch(/not reachable from in progress/i);
    expect(done?.allowed).toBe(false);
    expect(done?.reason).toMatch(/not reachable from in progress/i);
  });

  it("marks the current stage itself as disabled with a reason", () => {
    const options = nextStagesFrom("revision");
    const self = options.find((o) => o.stage === "revision");
    expect(self?.allowed).toBe(false);
    expect(self?.reason).toBeTruthy();
  });

  it("done offers exactly one move — Reopen to in_progress", () => {
    const options = nextStagesFrom("done");
    const allowed = options.filter((o) => o.allowed);
    expect(allowed).toHaveLength(1);
    expect(allowed[0].stage).toBe("in_progress");
    expect(allowed[0].actionLabel).toBe("Reopen");
  });

  it("property: never marks a transition allowed that isValidTransition rejects", () => {
    for (const from of PRODUCTION_STAGE_ORDER) {
      const options = nextStagesFrom(from);
      for (const option of options) {
        const graphSaysLegal = isValidTransition(
          from,
          option.stage as ProductionStage,
        );
        if (option.allowed) {
          expect(graphSaysLegal).toBe(true);
        } else {
          expect(graphSaysLegal).toBe(false);
        }
      }
    }
  });
});
