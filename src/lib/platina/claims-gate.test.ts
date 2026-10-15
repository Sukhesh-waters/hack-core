import { describe, expect, it } from "vitest";
import { claimsDnaFromRules, claimsGate, DEFAULT_CLAIMS_DNA, detectRuleConflicts } from "./claims-gate";

describe("claimsGate", () => {
  it("passes clean copy", () => {
    const result = claimsGate({
      contentPlan: "Accurate, reproducible chromatography results.",
      taskTitles: ["Finalize messaging"],
      hasException: false,
    });
    expect(result.verdict).toBe("passed");
    expect(result.blocksApproval).toBe(false);
  });

  it("a deterministic violation blocks approval without an exception", () => {
    const result = claimsGate({
      contentPlan: "Our system is guaranteed to pass every audit.",
      taskTitles: [],
      hasException: false,
    });
    expect(result.verdict).toBe("flagged");
    expect(result.blocksApproval).toBe(true);
  });

  it("a named-approver exception unblocks — but the violation stays visible", () => {
    const result = claimsGate({
      contentPlan: "Clinically proven performance.",
      taskTitles: [],
      hasException: true,
    });
    expect(result.verdict).toBe("flagged");
    expect(result.excepted).toBe(true);
    expect(result.blocksApproval).toBe(false);
  });

  it("task titles are screened too", () => {
    const result = claimsGate({
      contentPlan: null,
      taskTitles: ["Publish the cure claim"],
      hasException: false,
    });
    expect(result.blocksApproval).toBe(true);
  });
});

describe("claimsDnaFromRules", () => {
  it("falls back to the documented defaults when no workspace rules exist", () => {
    const { dna, source } = claimsDnaFromRules([]);
    expect(source).toBe("default");
    expect(dna).toEqual(DEFAULT_CLAIMS_DNA);
  });

  it("workspace rules replace the defaults entirely", () => {
    const { dna, source } = claimsDnaFromRules([
      { kind: "banned_term", term: "revolutionary" },
      { kind: "regulated_claim", term: "ISO certified" },
    ]);
    expect(source).toBe("workspace");
    expect(dna.bannedTerms).toEqual(["revolutionary"]);
    expect(dna.regulatedClaims).toEqual(["ISO certified"]);
    // The default list is NOT merged in — the workspace owns its rules.
    expect(dna.bannedTerms).not.toContain("cure");
  });

  it("changing the rules changes what the next audit flags", () => {
    const before = claimsDnaFromRules([]).dna;
    const after = claimsDnaFromRules([
      { kind: "banned_term", term: "seamless" },
    ]).dna;
    expect(before.bannedTerms).not.toContain("seamless");
    expect(after.bannedTerms).toContain("seamless");
  });

  it("B9 Heinz rule conflict: a top-third idea blocked by claimsGate is escalated with both sides shown, and the rule wins", () => {
    const conflicts = detectRuleConflicts([
      {
        id: "idea-1",
        title: "Guaranteed PFAS compliance in 24 hours",
        text: "Our workflow is guaranteed to pass every lab audit.",
        score: 0.92,
        evidence: ["4 of 5 PFAS posts beat baseline"],
      },
      {
        id: "idea-2",
        title: "Water lab webinar",
        text: "Join our technical session on drinking-water workflows.",
        score: 0.65,
        evidence: ["ARABLAB attendance"],
      },
      {
        id: "idea-3",
        title: "Low-scoring banned draft",
        text: "Best in class instrument.",
        score: 0.25,
        evidence: ["Old post"],
      },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      id: "idea-1",
      ruleWins: true,
      blocked: true,
      evidenceSide: { score: 0.92, rank: 1, total: 3, evidence: ["4 of 5 PFAS posts beat baseline"] },
    });
    expect(conflicts[0].ruleSide.summary).toContain("guaranteed");
  });
});
