import { describe, expect, it } from "vitest";
import {
  buildReportCsv,
  buildReportDraft,
  buildReportEmail,
  nextMonthRange,
} from "./reports";

describe("nextMonthRange", () => {
  it("mid-year: next month within the same year", () => {
    const { start, end } = nextMonthRange(new Date(2026, 6, 15)); // Jul 2026
    expect(start).toEqual(new Date(2026, 7, 1)); // Aug 1
    expect(end).toEqual(new Date(2026, 8, 1)); // Sep 1
  });

  it("December: rolls over into next year", () => {
    const { start, end } = nextMonthRange(new Date(2026, 11, 20)); // Dec 2026
    expect(start).toEqual(new Date(2027, 0, 1)); // Jan 1, 2027
    expect(end).toEqual(new Date(2027, 1, 1)); // Feb 1, 2027
  });
});

describe("buildReportDraft", () => {
  it("includes stat rollup, format breakdown, and next-month count", () => {
    const draft = buildReportDraft({
      clientName: "Aurora Skincare",
      posts: 24,
      scored: 20,
      avgEngagement: 0.045,
      insufficient: false,
      formats: [
        { format: "reel", count: 10, avgEngagement: 0.06 },
        { format: "post", count: 14, avgEngagement: 0.03 },
      ],
      nextMonthScheduled: 3,
      monthLabel: "August",
    });
    expect(draft).toContain("Aurora Skincare");
    expect(draft).toContain("Posts tracked: 24");
    expect(draft).toContain("reel: 10 posts, 6.0% avg engagement");
    expect(draft).toContain("August preview: 3 posts already scheduled");
  });

  it("min-N gate: below baseline, no engagement number leaves in the report", () => {
    const draft = buildReportDraft({
      clientName: "Fresh Client",
      posts: 3,
      scored: 1,
      // A real average exists in the DB (one lucky high-ER post) but the
      // client is below baseline — it must NOT appear in the outbound draft.
      avgEngagement: 0.084,
      insufficient: true,
      formats: [{ format: "reel", count: 3, avgEngagement: 0.084 }],
      nextMonthScheduled: 0,
      monthLabel: "August",
    });
    expect(draft).toContain("insufficient baseline");
    expect(draft).not.toContain("8.4%");
    expect(draft).not.toContain("By format:");
    expect(draft).toContain("August preview: 0 posts already scheduled");
  });

  it("handles a zero-post client without fabricating numbers", () => {
    const draft = buildReportDraft({
      clientName: "New Client",
      posts: 0,
      scored: 0,
      avgEngagement: null,
      insufficient: true,
      formats: [],
      nextMonthScheduled: 0,
      monthLabel: "August",
    });
    expect(draft).not.toContain("Average engagement: —");
    expect(draft).toContain("insufficient baseline");
    expect(draft).toContain("August preview: 0 posts already scheduled");
  });
});

describe("buildReportEmail", () => {
  it("wraps the body in a monospace pre block and escapes HTML", () => {
    const { subject, html } = buildReportEmail({
      clientName: "Aurora Skincare",
      body: "Line one\n<script>evil()</script>",
    });
    expect(subject).toBe("Performance report — Aurora Skincare");
    expect(html).toContain("Line one");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>evil()</script>");
  });
});

describe("buildReportCsv", () => {
  it("generates structured CSV with headers, format rows, and drivers", () => {
    const csv = buildReportCsv({
      clientName: "Aurora Skincare",
      clientHandle: "@auroraskin",
      generatedAt: new Date(2026, 8, 9),
      posts: 25,
      scored: 22,
      avgEngagement: 0.048,
      insufficient: false,
      formats: [
        { format: "reel", count: 12, avgEngagement: 0.065 },
        { format: "carousel", count: 13, avgEngagement: 0.032 },
      ],
      topDrivers: [
        {
          caption: 'Summer launch, "sun & sand" special',
          format: "reel",
          magnitude: 0.42,
        },
      ],
      underperformers: [
        {
          caption: "Simple notice",
          format: "carousel",
          magnitude: 0.25,
        },
      ],
      nextMonthScheduled: 4,
      monthLabel: "October",
    });

    expect(csv).toContain("Performance Report,Aurora Skincare");
    expect(csv).toContain("Handle,@auroraskin");
    expect(csv).toContain("Posts Tracked,25");
    expect(csv).toContain("Scored Posts,22");
    expect(csv).toContain("Average Engagement,4.8%");
    expect(csv).toContain("Baseline Status,Cleared");
    expect(csv).toContain("Format Breakdown");
    expect(csv).toContain("reel,12,6.5%");
    expect(csv).toContain("carousel,13,3.2%");
    expect(csv).toContain("Top Performance Drivers (Above Baseline)");
    // Assert RFC 4180 escaping for quotes and commas
    expect(csv).toContain('"Summer launch, ""sun & sand"" special",reel,+42%');
    expect(csv).toContain("Underperformers (Below Baseline)");
    expect(csv).toContain("Simple notice,carousel,-25%");
    expect(csv).toContain("October Scheduled Preview,4 posts");
  });

  it("min-N gate: suppresses engagement percentages when insufficient", () => {
    const csv = buildReportCsv({
      clientName: "New Brand",
      posts: 4,
      scored: 2,
      avgEngagement: 0.12,
      insufficient: true,
      formats: [{ format: "post", count: 4, avgEngagement: 0.12 }],
      topDrivers: [{ caption: "One lucky post", magnitude: 0.8 }],
      underperformers: [],
      nextMonthScheduled: 1,
      monthLabel: "October",
    });

    expect(csv).toContain("Average Engagement,Insufficient baseline");
    expect(csv).toContain(
      "Baseline Status,Below baseline (< 10 first-party posts)",
    );
    expect(csv).not.toContain("12.0%");
    expect(csv).not.toContain("+80%");
    expect(csv).toContain("October Scheduled Preview,1 post");
  });

  it("handles empty lists gracefully", () => {
    const csv = buildReportCsv({
      clientName: "Empty Client",
      posts: 0,
      scored: 0,
      avgEngagement: null,
      insufficient: true,
      formats: [],
      nextMonthScheduled: 0,
      monthLabel: "November",
    });

    expect(csv).toContain("Empty Client");
    expect(csv).toContain("Posts Tracked,0");
    expect(csv).toContain("November Scheduled Preview,0 posts");
  });
});

