import { describe, expect, it } from "vitest";
import { MAX_REFINE_RETRIES, enforceClaims, findBannedTerms } from "./claims";

const dna = {
  bannedTerms: ["cure", "guaranteed"],
  regulatedClaims: ["clinically proven"],
};

describe("claims screen", () => {
  it("uses a single {rule, excerpt, why} violation shape", () => {
    const [v] = findBannedTerms("This will cure the fault", dna);
    expect(v).toMatchObject({ rule: "banned_term" });
    expect(v.excerpt).toBeTruthy();
    expect(v.why).toMatch(/cure/);
  });

  it("lets a deterministic hit override a clean model verdict", () => {
    const result = enforceClaims("guaranteed results", dna, []);
    expect(result.verdict).toBe("flagged");
    expect(result.source).toBe("deterministic");
  });

  it("passes clean copy", () => {
    expect(enforceClaims("Request a method-validation consult", dna).verdict).toBe(
      "passed",
    );
  });

  it("allows exactly one refine retry", () => {
    expect(MAX_REFINE_RETRIES).toBe(1);
  });
});
