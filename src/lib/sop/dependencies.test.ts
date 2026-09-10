import { describe, expect, it } from "vitest";
import {
  unknownDependencies,
  wouldCreateCycle,
  type SopStepNode,
} from "./dependencies";

const step = (id: string, dependsOn: string[] = []): SopStepNode => ({
  id,
  dependsOn,
});

describe("wouldCreateCycle", () => {
  it("allows a linear chain", () => {
    const steps = [step("a"), step("b", ["a"]), step("c", ["b"])];
    expect(wouldCreateCycle(steps, "c", ["b"])).toBe(false);
  });

  it("catches a step depending on itself", () => {
    const steps = [step("a")];
    expect(wouldCreateCycle(steps, "a", ["a"])).toBe(true);
  });

  it("catches a two-step cycle", () => {
    // b already depends on a; making a depend on b closes the loop.
    const steps = [step("a"), step("b", ["a"])];
    expect(wouldCreateCycle(steps, "a", ["b"])).toBe(true);
  });

  it("catches a cycle several hops away", () => {
    const steps = [step("a"), step("b", ["a"]), step("c", ["b"])];
    expect(wouldCreateCycle(steps, "a", ["c"])).toBe(true);
  });

  /**
   * A diamond (a → b, a → c, both → d) is not a cycle. Rejecting it would
   * ban the most common real shape: two things happen in parallel after a
   * brief, and a review waits on both.
   */
  it("allows a diamond — parallel branches that rejoin", () => {
    const steps = [
      step("brief"),
      step("design", ["brief"]),
      step("copy", ["brief"]),
    ];
    expect(wouldCreateCycle(steps, "review", ["design", "copy"])).toBe(false);
  });

  it("allows a step with no dependencies at all", () => {
    expect(wouldCreateCycle([step("a"), step("b", ["a"])], "c", [])).toBe(
      false,
    );
  });

  /**
   * The proposed list must win over the stored one. If the stored row still
   * said "c depends on b" while the user is removing that edge, a stale read
   * would reject an edit that actually breaks the cycle.
   */
  it("uses the proposed dependencies, not the step's stored ones", () => {
    const steps = [step("a", ["c"]), step("b", ["a"]), step("c", ["b"])];
    // Cycle exists today (a→c→b→a). Clearing a's deps must be allowed.
    expect(wouldCreateCycle(steps, "a", [])).toBe(false);
  });

  it("tolerates a dependency id that names no known step", () => {
    expect(wouldCreateCycle([step("a")], "a", ["ghost"])).toBe(false);
  });

  it("does not fall over on an already-cyclic graph elsewhere", () => {
    // x↔y is broken, but we're asking about an unrelated step.
    const steps = [step("x", ["y"]), step("y", ["x"]), step("a")];
    expect(wouldCreateCycle(steps, "a", [])).toBe(false);
  });
});

describe("unknownDependencies", () => {
  it("returns ids with no matching step", () => {
    const steps = [step("a"), step("b")];
    expect(unknownDependencies(steps, ["a", "gone", "b"])).toEqual(["gone"]);
  });

  it("returns nothing when every id resolves", () => {
    expect(unknownDependencies([step("a"), step("b")], ["a", "b"])).toEqual([]);
  });

  it("returns nothing for an empty dependency list", () => {
    expect(unknownDependencies([step("a")], [])).toEqual([]);
  });

  it("treats every id as unknown when the template has no steps", () => {
    expect(unknownDependencies([], ["a", "b"])).toEqual(["a", "b"]);
  });
});
