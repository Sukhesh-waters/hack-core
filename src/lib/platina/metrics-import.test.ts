import { describe, expect, it } from "vitest";
import {
  headerKey,
  parseCount,
  parseMetricsSheet,
  parseSheetDate,
  refKey,
  splitCsvLine,
  splitImportRows,
} from "./metrics-import";

const TODAY = new Date("2026-09-22T00:00:00Z");

describe("cells", () => {
  it("splits quoted CSV and normalises headers", () => {
    expect(splitCsvLine('a,"b, c",d')).toEqual(["a", "b, c", "d"]);
    expect(splitCsvLine('"say ""hi""",x')).toEqual(['say "hi"', "x"]);
    expect(headerKey("﻿Post link")).toBe("post_link");
    expect(headerKey("Video Views")).toBe("video_views");
  });

  it("numbers: separators and percent ok; empty is null, never 0; junk is NaN", () => {
    expect(parseCount("1,234")).toBe(1234);
    expect(parseCount("12.5%")).toBe(12.5);
    expect(parseCount("")).toBeNull();
    expect(parseCount("-")).toBeNull();
    expect(parseCount("lots")).toBeNaN();
    expect(parseCount("-4")).toBeNaN();
  });

  it("dates: ISO and LinkedIn MM/DD/YYYY", () => {
    expect(parseSheetDate("2026-09-20")?.toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(parseSheetDate("09/20/2026")?.toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(parseSheetDate("20 Sept")).toBeNull();
  });

  it("refKey matches the same URL written two ways", () => {
    expect(refKey("https://www.linkedin.com/feed/update/urn:li:activity:1/?utm=x")).toBe(
      refKey("linkedin.com/feed/update/urn:li:activity:1"),
    );
  });
});

describe("parseMetricsSheet", () => {
  it("Platina layout: date / captured_at is the capture date", () => {
    const r = parseMetricsSheet(
      "creative,captured_at,impressions,engagements,leads\nhttps://x.com/p/1,2026-09-20,1000,30,\nc-2,,500,,2",
      TODAY,
    );
    expect(r.layout).toBe("platina");
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({
      ref: "https://x.com/p/1",
      capturedAt: new Date("2026-09-20T00:00:00Z"),
      postedAt: null,
      impressions: 1000,
      engagements: 30,
      leads: null,
      qualifiedLeads: null,
    });
    expect(r.rows[1]).toMatchObject({ ref: "c-2", capturedAt: TODAY, engagements: null, leads: 2, qualifiedLeads: null });
  });

  it("B9 (D4): parses optional qualified_leads when supplied, and leaves it null ('not measured') when absent", () => {
    const r = parseMetricsSheet(
      "creative,impressions,leads,qualified_leads\nc-1,1000,12,5\nc-2,800,4,",
      TODAY,
    );
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ ref: "c-1", leads: 12, qualifiedLeads: 5 });
    expect(r.rows[1]).toMatchObject({ ref: "c-2", leads: 4, qualifiedLeads: null });
  });

  it("WTR-0 A1 LinkedIn export: created_date maps to postedAt, capturedAt defaults to today, update_title is kept", () => {
    const r = parseMetricsSheet(
      'Update title,Post link,Created date,Impressions,Clicks,Reactions,Comments,Reposts\n"GLP-1, faster",https://www.linkedin.com/feed/update/urn:li:activity:1,09/18/2026,"2,400",40,55,6,3',
      TODAY,
    );
    expect(r.layout).toBe("linkedin");
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({
      title: "GLP-1, faster",
      impressions: 2400,
      clicks: 40,
      engagements: 64,
      shares: 3,
    });
    expect(r.rows[0].postedAt?.toISOString()).toBe("2026-09-18T00:00:00.000Z");
    expect(r.rows[0].capturedAt.toISOString()).toBe(TODAY.toISOString());
  });

  it("explicit captured_at column overrides today even alongside created_date", () => {
    const r = parseMetricsSheet(
      "Post link,Created date,captured_at,Impressions,Reactions\nhttps://www.linkedin.com/feed/update/urn:li:activity:1,09/18/2026,2026-09-25,1200,30",
      TODAY,
    );
    expect(r.errors).toEqual([]);
    expect(r.rows[0].postedAt?.toISOString()).toBe("2026-09-18T00:00:00.000Z");
    expect(r.rows[0].capturedAt.toISOString()).toBe("2026-09-25T00:00:00.000Z");
  });

  it("tab-separated paste from a spreadsheet works", () => {
    const r = parseMetricsSheet("creative\timpressions\tengagements\nc-1\t100\t5", TODAY);
    expect(r.rows[0]).toMatchObject({ ref: "c-1", impressions: 100, engagements: 5 });
  });

  it("bad rows are errors with line numbers; good rows still parse", () => {
    const r = parseMetricsSheet("creative,impressions,captured_at\nc-1,lots,2026-09-01\n,5,\nc-3,7,2026-13-45", TODAY);
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([
      'line 2: "lots" in impressions is not a number',
      "line 3: no creative URL or id",
      'line 4: "2026-13-45" is not a date (use YYYY-MM-DD)',
    ]);
  });

  it("refuses a sheet with no creative column or no numbers", () => {
    expect(parseMetricsSheet("impressions\n5", TODAY).errors[0]).toContain("naming the creative");
    expect(parseMetricsSheet("creative,notes\nc-1,hi", TODAY).errors[0]).toContain("No number columns");
    expect(parseMetricsSheet("creative", TODAY).errors[0]).toContain("header row");
  });
});

describe("splitImportRows (WTR-0 A2)", () => {
  const creatives = [
    { id: "cr-1", url: "https://www.linkedin.com/feed/update/urn:li:activity:100/", externalId: null },
    { id: "cr-2", url: null, externalId: "urn:li:activity:200" },
  ];

  it("separates matched rows from unassigned posts and normalises URLs", () => {
    const parsed = parseMetricsSheet(
      [
        "Update title,Post link,Created date,Impressions,Reactions",
        '"Known post",https://linkedin.com/feed/update/urn:li:activity:100?utm=1,09/18/2026,1500,40',
        '"Unassigned post",https://linkedin.com/feed/update/urn:li:activity:999,09/19/2026,800,12',
      ].join("\n"),
      TODAY,
    );
    const split = splitImportRows(parsed.rows, creatives);
    expect(split.duplicates).toBe(0);
    expect(split.matched).toHaveLength(1);
    expect(split.matched[0]).toMatchObject({ creativeId: "cr-1", impressions: 1500, engagements: 40 });
    expect(split.unassigned).toEqual([
      {
        ref: "https://linkedin.com/feed/update/urn:li:activity:999",
        title: "Unassigned post",
        postedAt: "2026-09-19",
        impressions: 800,
      },
    ]);
  });

  it("collapses duplicate rows for the same post in one sheet (last wins) and counts duplicates", () => {
    const parsed = parseMetricsSheet(
      [
        "Update title,Post link,Created date,Impressions,Reactions",
        '"First export row",https://linkedin.com/feed/update/urn:li:activity:100,09/18/2026,1200,30',
        '"Updated row",https://www.linkedin.com/feed/update/urn:li:activity:100/,09/18/2026,1550,45',
        '"Dup unknown 1",https://linkedin.com/feed/update/urn:li:activity:999,09/19/2026,400,5',
        '"Dup unknown 2",https://linkedin.com/feed/update/urn:li:activity:999/,09/19/2026,450,8',
      ].join("\n"),
      TODAY,
    );
    const split = splitImportRows(parsed.rows, creatives);
    expect(split.duplicates).toBe(2);
    expect(split.matched).toHaveLength(1);
    expect(split.matched[0]?.impressions).toBe(1550);
    expect(split.unassigned).toHaveLength(1);
    expect(split.unassigned[0]?.impressions).toBe(450);
  });
});
