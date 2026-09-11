import { describe, expect, it } from "vitest";
import { buildIdeationBrief, draftProposals, proposeCampaignDetail } from "./ideation";

describe("platina ideation", () => {
  it("refuses to propose when there is no plane-A evidence", () => {
    const proposals = draftProposals("validation", {
      evidence: [],
      hypotheses: [
        {
          id: "c1",
          content: "market buzz",
          plane: "C",
          confidence: 0.8,
          generation: 0,
        },
      ],
    });
    expect(proposals).toHaveLength(0);
  });

  it("labels evidence and hypothesis separately", () => {
    const brief = buildIdeationBrief(
      {
        evidence: [{ id: "a1", content: "our last symposium converted", plane: "A" }],
        hypotheses: [
          {
            id: "c1",
            content: "competitors talking validation",
            plane: "C",
            confidence: 0.7,
            generation: 0,
          },
        ],
      },
      1,
    );
    expect(brief.labelled.evidenceLabel).toContain("our own data");
    expect(brief.labelled.hypothesisLabel).toContain("unvalidated");
    expect(brief.support.ok).toBe(true);
  });

  it("proposes an editable campaign detail", () => {
    const detail = proposeCampaignDetail({
      title: "ASMS follow-up",
      hypothesis: "validation pain converts",
    });
    expect(detail.channelMix).toContain("conference");
    expect(detail.contentPlan).toMatch(/Hypothesis/);
  });
});
