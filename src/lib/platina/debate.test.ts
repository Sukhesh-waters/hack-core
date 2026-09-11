import { describe, expect, it } from "vitest";
import { ONE_ROUND, nextRoundAllowed } from "./contradiction";

describe("debate round cap", () => {
  it("hard-codes a single contradiction round", () => {
    expect(ONE_ROUND).toBe(1);
    expect(nextRoundAllowed()).toBe(false);
  });
});
