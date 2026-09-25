import { describe, expect, it } from "vitest";
import { checkPagesHaveContent, pageReadiness, type PageFactsInput } from "./readiness-pages";

const empty: PageFactsInput = {
  findings: 0,
  findingsNewest: null,
  runs: 0,
  runsNewest: null,
  signals: 0,
  signalsNewest: null,
  adDocs: 0,
  adDocsNewest: null,
  brain: 0,
  brainNewest: null,
  brands: 0,
  profiles: 0,
  interest: 0,
  interestNewest: null,
  eventsUpcoming: 0,
  eventsUndated: 0,
  eventsNewest: null,
  plans: 0,
  plansNewest: null,
  creatives: 0,
  creativesNewest: null,
  outcomes: 0,
  solutionTasks: 0,
  brandChunks: 0,
  ownChunks: 0,
  ownChunksNewest: null,
  learningEvents: 0,
};

/** Waters on 23 Sep 2026: collection full, everything after it empty. */
const waters: PageFactsInput = {
  ...empty,
  findings: 229,
  findingsNewest: "2026-09-23 06:10:00",
  runs: 86,
  runsNewest: "2026-09-23 06:12:00",
  signals: 238,
  signalsNewest: "2026-09-23 06:12:41",
  adDocs: 10,
  brain: 132,
  brainNewest: "2026-09-23 06:11:00",
  brands: 6,
  interest: 301,
  eventsUpcoming: 5,
  eventsUndated: 16,
  plans: 1,
  ownChunks: 397,
};

const bySlug = (rows: ReturnType<typeof pageReadiness>) => new Map(rows.map((r) => [r.page, r]));

describe("pageReadiness (C8.0)", () => {
  it("reports every page of a new workspace as empty, each with the step that fills it", () => {
    const rows = pageReadiness(empty);
    expect(rows.every((r) => r.status === "empty")).toBe(true);
    expect(rows.every((r) => r.gap && r.gap.length > 10)).toBe(true);
  });

  it("names what is missing for Waters, not just that something is", () => {
    const rows = bySlug(pageReadiness(waters));
    expect(rows.get("Live flow")!.status).toBe("content");
    expect(rows.get("Results")!.status).toBe("empty");
    expect(rows.get("Clients")!).toMatchObject({ status: "thin", gap: expect.stringContaining("workspace profile") });
    expect(rows.get("Opportunities")!).toMatchObject({ status: "thin", gap: expect.stringContaining("16 events") });
    expect(rows.get("Brand Gene")!).toMatchObject({ status: "thin", gap: expect.stringContaining("Confirm as brand standard") });
    expect(rows.get("Live flow")!.newest).toBe("2026-09-23 06:12:41");
  });

  it("undated events alone still count as content", () => {
    const rows = bySlug(pageReadiness({ ...empty, eventsUndated: 3 }));
    expect(rows.get("Opportunities")!.status).toBe("thin");
  });
});

describe("checkPagesHaveContent", () => {
  it("is amber when a main page is empty, naming it and its next step", () => {
    const check = checkPagesHaveContent(pageReadiness(waters));
    expect(check.status).toBe("degraded");
    expect(check.detail).toBe("Results is empty.");
    expect(check.remedy).toContain("log creatives");
  });

  it("is green when main pages have content, listing thin ones", () => {
    const full = { ...waters, creatives: 4, profiles: 1 };
    const check = checkPagesHaveContent(pageReadiness(full));
    expect(check.status).toBe("ok");
    expect(check.detail).toContain("thin: Opportunities, Brand Gene");
  });

  it("an empty secondary page (Solutions) does not turn it amber", () => {
    const check = checkPagesHaveContent(pageReadiness({ ...waters, creatives: 1 }));
    expect(check.status).toBe("ok");
  });
});
