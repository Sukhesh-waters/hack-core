import { describe, expect, it } from "vitest";
import {
  BODY_BUDGET,
  UNLINKED_SUBJECT,
  buildAnalysisInput,
  buildNumberedAnalysisInput,
  describeMetrics,
} from "./analysis-input";

const subject = {
  competitorName: "Bluebird Roasters",
  clientName: "Northwind Coffee",
  sourceKind: "competitor_site",
  url: "https://bluebird.example/pricing",
  collectedAt: new Date("2026-09-21T09:30:00Z"),
};

const parts = {
  subject,
  title: "Pricing",
  body: "Plans start at £9 a month.",
  change: null,
};

describe("identity comes first", () => {
  it("names the competitor and the client it is watched for", () => {
    const out = buildAnalysisInput(parts);
    expect(out).toContain("Competitor: Bluebird Roasters");
    expect(out).toContain("Watched for client: Northwind Coffee");
    expect(out).toContain("https://bluebird.example/pricing");
    expect(out).toContain("Collected: 2026-09-21");
    expect(out).toContain("Page title: Pricing");
  });

  it("says a source is unlinked rather than guessing a name", () => {
    const out = buildAnalysisInput({
      ...parts,
      subject: { ...subject, competitorName: null, clientName: null },
    });
    expect(out).toContain(`Competitor: ${UNLINKED_SUBJECT}`);
    expect(out).not.toContain("Watched for client");
  });

  it("describes the source kind in words, not as a database enum", () => {
    expect(buildAnalysisInput(parts)).toContain("a page on the competitor's own website");
    expect(
      buildAnalysisInput({ ...parts, subject: { ...subject, sourceKind: "press_release" } }),
    ).toContain("a press release");
  });

  it("falls back to the raw kind when it is one we have no words for", () => {
    expect(
      buildAnalysisInput({ ...parts, subject: { ...subject, sourceKind: "newsletter" } }),
    ).toContain("newsletter");
  });
});

describe("the change section", () => {
  it("puts the change BEFORE the page text — the change is the signal", () => {
    const out = buildAnalysisInput({
      ...parts,
      body: "The page body mentions roast guarantees.",
      change: { summary: "This page changed since 7 days ago: 1 new line(s)." },
    });
    expect(out.indexOf("WHAT CHANGED")).toBeLessThan(out.indexOf("PAGE TEXT"));
    expect(out).toContain("1 new line(s)");
  });

  it("says plainly when this is a first look, so a baseline is not read as a move", () => {
    const out = buildAnalysisInput(parts);
    expect(out).toContain("first look, not a change");
  });
});

describe("engagement", () => {
  it("renders only the numbers that exist", () => {
    expect(describeMetrics({ likes: 412, comments: 18 })).toBe("412 likes, 18 comments");
    expect(describeMetrics({ followers: 9000 })).toBe("9000 followers");
    expect(describeMetrics({})).toBeNull();
    expect(describeMetrics(null)).toBeNull();
  });

  it("keeps a zero, because zero is a measurement", () => {
    expect(describeMetrics({ likes: 0 })).toBe("0 likes");
  });

  it("adds the posting date when there is one", () => {
    expect(describeMetrics({ views: 20, postedAt: "2026-09-14T00:00:00.000Z" })).toBe(
      "20 views, posted 2026-09-14",
    );
  });

  it("labels engagement as measured, not claimed", () => {
    const out = buildAnalysisInput({ ...parts, metrics: { likes: 5 } });
    expect(out).toContain("MEASURED ENGAGEMENT");
    expect(out).toContain("not claims");
  });

  it("omits the section entirely when there is nothing measured", () => {
    expect(buildAnalysisInput(parts)).not.toContain("MEASURED ENGAGEMENT");
  });
});

describe("the page text", () => {
  it("passes a short body through whole", () => {
    expect(buildAnalysisInput(parts)).toContain("Plans start at £9 a month.");
  });

  it("truncates a long body and says so, with the real size", () => {
    const body = "x".repeat(BODY_BUDGET + 500);
    const out = buildAnalysisInput({ ...parts, body });
    expect(out).toContain(`first ${BODY_BUDGET} of ${BODY_BUDGET + 500} characters`);
    expect(out).toContain("[…truncated]");
    expect(out.length).toBeLessThan(body.length);
  });

  it("is deterministic", () => {
    expect(buildAnalysisInput(parts)).toBe(buildAnalysisInput(parts));
  });
});

describe("buildNumberedAnalysisInput (B1 — interrogation why-ids)", () => {
  it("tags each diff line, the metric line and each paragraph, in that order, and never the identity block", () => {
    const { input, spans } = buildNumberedAnalysisInput({
      ...parts,
      body: "First paragraph about the move.\n\nSecond paragraph, a different point.",
      change: { summary: "Line one changed.\nLine two changed." },
      metrics: { likes: 5 },
    });
    expect(input).not.toMatch(/\[e\d+\] Competitor:/);
    expect(spans).toEqual({
      e1: "Line one changed.",
      e2: "Line two changed.",
      e3: "5 likes",
      e4: "First paragraph about the move.",
      e5: "Second paragraph, a different point.",
    });
    expect(input).toContain("[e1] Line one changed.");
    expect(input).toContain("[e5] Second paragraph, a different point.");
  });

  it("every id in the map is findable verbatim in the rendered input", () => {
    const { input, spans } = buildNumberedAnalysisInput({
      ...parts,
      body: "Para A.\n\nPara B.",
      change: { summary: "Changed." },
    });
    for (const [id, text] of Object.entries(spans)) {
      expect(input).toContain(`[${id}] ${text}`);
    }
  });

  it("a first look (no previous version) still numbers the page text, with no diff-line ids", () => {
    const { spans } = buildNumberedAnalysisInput(parts);
    expect(Object.keys(spans)).toEqual(["e1"]);
    expect(spans.e1).toBe(parts.body);
  });

  it("truncation is not itself tagged as a span", () => {
    const body = Array.from({ length: 5 }, (_, i) => `Paragraph ${i}.`).join("\n\n").repeat(400);
    const { input, spans } = buildNumberedAnalysisInput({ ...parts, body });
    expect(input).toContain("[…truncated]");
    expect(Object.values(spans).every((s) => !s.includes("[…truncated]"))).toBe(true);
  });

  it("is deterministic", () => {
    expect(buildNumberedAnalysisInput(parts)).toEqual(buildNumberedAnalysisInput(parts));
  });
});
