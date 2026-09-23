import { describe, expect, it } from "vitest";
import {
  checkBudgets,
  checkCollectionFreshness,
  checkEmbeddings,
  checkEvents,
  checkKnowledgeOwnership,
  checkLearning,
  checkOwnSite,
  checkStuckRuns,
  newlyRed,
  opsTotals,
  projectSpend,
} from "./checks";

const NOW = new Date("2026-09-23T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("checkKnowledgeOwnership", () => {
  it("is red when another company's page is in first-party knowledge (the 22 Sep leak)", () => {
    const c = checkKnowledgeOwnership({
      notOwn: [{ url: "https://www.thermofisher.com/in/en/home.html", client: "waters", owner: "Thermo Fisher Scientific" }],
      clientsWithoutOwnList: [],
    });
    expect(c.status).toBe("down");
    expect(c.detail).toContain("Thermo Fisher Scientific");
    expect(c.remedy).toContain("kb-quarantine");
  });
  it("is amber when a client has pages but no own list, green when clean", () => {
    expect(checkKnowledgeOwnership({ notOwn: [], clientsWithoutOwnList: ["SLAM"] }).status).toBe("degraded");
    expect(checkKnowledgeOwnership({ notOwn: [], clientsWithoutOwnList: [] }).status).toBe("ok");
  });
});

describe("checkOwnSite", () => {
  const site = { client: "Waters", total: 300, read: 17, queued: 276, failed: 7, error: null };
  it("amber when pages wait and nothing was read for 2 days", () => {
    expect(checkOwnSite({ now: NOW, sites: [{ ...site, lastReadAt: daysAgo(3) }] }).status).toBe("degraded");
  });
  it("green while reading continues", () => {
    const c = checkOwnSite({ now: NOW, sites: [{ ...site, lastReadAt: daysAgo(0.5) }] });
    expect(c.status).toBe("ok");
    expect(c.detail).toContain("Waters: 17/300 read, 276 queued, 7 failed");
  });
  it("grey with no website set", () => {
    expect(checkOwnSite({ now: NOW, sites: [] }).status).toBe("not_configured");
  });
});

describe("checkEmbeddings", () => {
  it("red over 500 waiting, amber for any backlog or failure, green when caught up", () => {
    expect(checkEmbeddings({ waiting: 501, failures24h: 0 }).status).toBe("down");
    expect(checkEmbeddings({ waiting: 0, failures24h: 2 }).status).toBe("degraded");
    expect(checkEmbeddings({ waiting: 0, failures24h: 0 }).status).toBe("ok");
  });
});

describe("checkCollectionFreshness", () => {
  const src = (name: string, lastSuccessDaysAgo: number | null, cadenceMinutes = 1440) => ({
    name,
    cadenceMinutes,
    lastSuccessAt: lastSuccessDaysAgo === null ? null : daysAgo(lastSuccessDaysAgo),
    lastFailureAt: null,
    createdAt: daysAgo(30),
  });
  it("a fast source that is quiet for a day is not late; one quiet for 3 days is", () => {
    expect(checkCollectionFreshness({ now: NOW, sources: [src("a", 1, 5), src("b", 0.2)] }).status).toBe("ok");
    expect(checkCollectionFreshness({ now: NOW, sources: [src("a", 3, 5), src("b", 0.2), src("c", 0.1)] }).status).toBe("degraded");
  });
  it("red when most sources are late", () => {
    expect(checkCollectionFreshness({ now: NOW, sources: [src("a", 5), src("b", 6), src("c", 0.1)] }).status).toBe("down");
  });
  it("a failure newer than the last success counts as failing", () => {
    const c = checkCollectionFreshness({
      now: NOW,
      sources: [{ ...src("thermo", 0.5), lastFailureAt: daysAgo(0.1) }],
    });
    expect(c.status).toBe("degraded");
    expect(c.detail).toContain("thermo");
  });
});

describe("checkEvents", () => {
  const gulf = ["AE", "SA", "QA", "KW", "OM", "BH"] as const;
  it("green with a Gulf event inside 60 days, naming the next one", () => {
    const c = checkEvents({
      now: NOW,
      regionCountries: gulf,
      regionLabel: "the Gulf",
      events: [
        { name: "ARABLAB LIVE 2026", startsOn: "2026-10-26", country: "AE" },
        { name: "ASMS 2027", startsOn: "2027-06-06", country: "US" },
        { name: "IMSC2026", startsOn: null, country: null },
      ],
    });
    expect(c.status).toBe("ok");
    expect(c.detail).toContain("ARABLAB LIVE 2026 on 2026-10-26");
    expect(c.value).toMatchObject({ upcoming: 2, inRegion: 1, undated: 1 });
  });
  it("amber when nothing in the region within 60 days", () => {
    expect(
      checkEvents({ now: NOW, regionCountries: gulf, regionLabel: "the Gulf", events: [{ name: "WHX Labs", startsOn: "2027-01-26", country: "AE" }] }).status,
    ).toBe("degraded");
  });
});

describe("checkLearning", () => {
  it("amber with no confirmed results, green otherwise", () => {
    expect(checkLearning({ results: 0, pastMinN: 0, minN: 5, reviewsWaiting: 0 }).status).toBe("degraded");
    const c = checkLearning({ results: 6, pastMinN: 2, minN: 5, reviewsWaiting: 1 });
    expect(c.status).toBe("ok");
    expect(c.detail).toContain("1 review waiting");
  });
});

describe("budgets", () => {
  const start = new Date("2026-09-01T00:00:00Z");
  const end = new Date("2026-09-30T23:59:59Z");
  it("projects spend to the end of the period", () => {
    expect(projectSpend(1, start, end, new Date("2026-09-16T00:00:00Z"))).toBeCloseTo(2, 1);
  });
  it("green under 80% and on track; amber when the projection passes the cap; red at the cap", () => {
    const apify = (used: number) => ({ name: "Apify", used, cap: 5, unit: "usd" as const, periodStart: start, periodEnd: end });
    expect(checkBudgets({ now: NOW, readings: [apify(0.88)] }).status).toBe("ok");
    // $3.50 by 23 Sep projects to about $4.67: still inside $5.
    expect(checkBudgets({ now: NOW, readings: [apify(3.5)] }).status).toBe("ok");
    // $3.90 projects past $5 (amber), and $4.20 is past 80% (amber).
    expect(checkBudgets({ now: NOW, readings: [apify(3.9)] }).status).toBe("degraded");
    expect(checkBudgets({ now: NOW, readings: [apify(4.2)] }).status).toBe("degraded");
    expect(checkBudgets({ now: NOW, readings: [apify(5)] }).status).toBe("down");
  });
  it("a reading that failed is amber and says why; an uncapped one is shown only", () => {
    const c = checkBudgets({
      now: NOW,
      readings: [
        { name: "Firecrawl", error: "401" },
        { name: "AI", used: 1.2, cap: null, unit: "usd", periodStart: start, periodEnd: end },
      ],
    });
    expect(c.status).toBe("degraded");
    expect(c.detail).toContain("Firecrawl: couldn't read (401)");
    expect(c.detail).toContain("AI: $1.20 so far");
  });
});

describe("checkStuckRuns and totals", () => {
  it("red when a run has been going for over an hour", () => {
    const c = checkStuckRuns({ now: NOW, running: [{ id: "r", startedAt: new Date(NOW.getTime() - 2 * 3_600_000), queuedAt: daysAgo(1) }] });
    expect(c.status).toBe("down");
    expect(opsTotals([c, checkEmbeddings({ waiting: 1, failures24h: 0 })])).toEqual({ redChecks: 1, amberChecks: 1 });
  });
});

describe("newlyRed", () => {
  it("only checks that turned red since the previous run", () => {
    const red = checkStuckRuns({ now: NOW, running: [{ id: "r", startedAt: new Date(NOW.getTime() - 7_200_000), queuedAt: daysAgo(1) }] });
    const amber = checkEmbeddings({ waiting: 1, failures24h: 0 });
    expect(newlyRed([], [red, amber]).map((c) => c.id)).toEqual(["stuck_runs"]);
    expect(newlyRed([{ checkId: "stuck_runs", status: "down" }], [red])).toEqual([]);
  });
});
