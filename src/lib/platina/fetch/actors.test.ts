import { describe, expect, it } from "vitest";
import type { PlatinaScanTarget } from "@/db/platina-schema";
import {
  clampPages,
  effectivePages,
  mapSocialItem,
  MAX_PAGES_CEILING,
  parseSocialRef,
  pickMetrics,
  planTarget,
} from "./actors";

const target = (over: Partial<PlatinaScanTarget>): PlatinaScanTarget => ({
  kind: "competitor_site",
  value: "https://example.com",
  ...over,
});

describe("clampPages / effectivePages", () => {
  it("defaults to 1 and enforces the hard ceiling", () => {
    expect(clampPages(undefined)).toBe(1);
    expect(clampPages(0)).toBe(1);
    expect(clampPages(-4)).toBe(1);
    expect(clampPages(3.9)).toBe(3);
    expect(clampPages(9999)).toBe(MAX_PAGES_CEILING);
    expect(clampPages(Number.NaN)).toBe(1);
  });

  it("never exceeds what the daily budget has left, and 0 means do not run", () => {
    expect(effectivePages({ maxPages: 25 }, 10)).toBe(10);
    expect(effectivePages({ maxPages: 5 }, 100)).toBe(5);
    expect(effectivePages({ maxPages: 5 }, 0)).toBe(0);
    expect(effectivePages({ maxPages: 5 }, undefined)).toBe(5);
  });
});

describe("parseSocialRef", () => {
  it.each([
    ["instagram:@acme", { platform: "instagram", handle: "acme" }],
    ["tiktok:acme.co", { platform: "tiktok", handle: "acme.co" }],
    ["https://www.instagram.com/acme/", { platform: "instagram", handle: "acme" }],
    ["https://www.tiktok.com/@acme", { platform: "tiktok", handle: "acme" }],
  ])("reads %s", (input, expected) => {
    expect(parseSocialRef(input)).toEqual(expected);
  });

  it.each(["", "acme", "linkedin:@acme", "https://example.com/acme", "instagram:@"])(
    "refuses %j instead of guessing",
    (input) => {
      expect(parseSocialRef(input)).toBeNull();
    },
  );
});

describe("planTarget", () => {
  it("keeps the single-page cheerio change detector as the default", () => {
    const plan = planTarget(target({}), 1);
    expect(plan.actor).toBe("apify~website-content-crawler");
    expect(plan.input).toMatchObject({
      maxCrawlPages: 1,
      maxCrawlDepth: 0,
      crawlerType: "cheerio",
      useSitemaps: false,
    });
  });

  it("widens the crawl for multi-page budgets and honours sitemap seeding", () => {
    expect(planTarget(target({}), 5).input).toMatchObject({
      maxCrawlPages: 5,
      maxCrawlDepth: 2,
    });
    expect(planTarget(target({ seedFromSitemap: true }), 5).input).toMatchObject({
      useSitemaps: true,
      maxCrawlDepth: 1,
    });
  });

  it("only renders JavaScript when the operator opted in", () => {
    expect(planTarget(target({}), 1).input).toMatchObject({ crawlerType: "cheerio" });
    expect(planTarget(target({ renderJs: true }), 1).input).toMatchObject({
      crawlerType: "playwright:adaptive",
    });
  });

  it("asks the ad actor for at least its 10-result minimum", () => {
    expect(planTarget(target({ kind: "ad_library" }), 1).input).toMatchObject({ count: 10 });
  });

  it.each([
    ["social_profile", "instagram:@acme", "apify~instagram-profile-scraper"],
    ["social_posts", "instagram:@acme", "apify~instagram-scraper"],
    ["social_profile", "tiktok:@acme", "clockworks~tiktok-profile-scraper"],
    ["social_posts", "tiktok:@acme", "clockworks~tiktok-scraper"],
  ] as const)("routes %s %s to %s", (kind, value, actor) => {
    expect(planTarget(target({ kind, value }), 3).actor).toBe(actor);
  });

  it("passes the post budget to the social actor", () => {
    expect(planTarget(target({ kind: "social_posts", value: "instagram:@acme" }), 7).input)
      .toMatchObject({ resultsLimit: 7 });
    expect(planTarget(target({ kind: "social_posts", value: "tiktok:@acme" }), 7).input)
      .toMatchObject({ resultsPerPage: 7 });
  });

  it("throws on a bad social value and on an unknown kind", () => {
    expect(() => planTarget(target({ kind: "social_posts", value: "acme" }), 1)).toThrow(
      /instagram:@handle/,
    );
    expect(() => planTarget(target({ kind: "mystery" as never }), 1)).toThrow(/no actor mapped/);
  });
});

describe("pickMetrics", () => {
  const none = { likes: undefined, comments: undefined, views: undefined, shares: undefined, followers: undefined };

  it("omits absent metrics rather than defaulting them to 0", () => {
    expect(pickMetrics({ ...none, likes: 12 })).toEqual({ likes: 12 });
    expect(pickMetrics(none)).toBeUndefined();
  });

  it("keeps a real zero and drops hidden (-1) and non-numeric values", () => {
    expect(pickMetrics({ ...none, likes: 0, comments: -1, views: "9" })).toEqual({ likes: 0 });
  });

  it("normalises ISO strings and unix seconds to ISO", () => {
    expect(pickMetrics(none, "2026-09-01T10:00:00Z")).toEqual({ postedAt: "2026-09-01T10:00:00.000Z" });
    expect(pickMetrics(none, 1788256800)?.postedAt).toMatch(/^2026-/);
  });
});

describe("mapSocialItem (fixtures)", () => {
  const ig = target({ kind: "social_posts", value: "instagram:@acme" });
  const tt = target({ kind: "social_posts", value: "tiktok:@acme" });

  it("maps an Instagram post with metrics", () => {
    const doc = mapSocialItem(
      {
        url: "https://www.instagram.com/p/AAA/",
        caption: "Launch day!",
        likesCount: 120,
        commentsCount: 4,
        videoViewCount: 900,
        timestamp: "2026-09-01T10:00:00.000Z",
      },
      ig,
      { platform: "instagram", handle: "acme" },
    );
    expect(doc?.body).toBe("Launch day!");
    expect(doc?.metrics).toEqual({
      likes: 120,
      comments: 4,
      views: 900,
      postedAt: "2026-09-01T10:00:00.000Z",
    });
    expect(doc?.contentHash).toBeTruthy();
    expect(doc?.sourceKind).toBe("social_posts");
  });

  it("omits hidden Instagram likes instead of storing -1", () => {
    const doc = mapSocialItem(
      { url: "https://www.instagram.com/p/BBB/", caption: "Quiet post", likesCount: -1, commentsCount: 0 },
      ig,
      { platform: "instagram", handle: "acme" },
    );
    expect(doc?.metrics).toEqual({ comments: 0 });
  });

  it("maps a TikTok post with author followers", () => {
    const doc = mapSocialItem(
      {
        webVideoUrl: "https://www.tiktok.com/@acme/video/1",
        text: "Behind the scenes",
        diggCount: 50,
        commentCount: 2,
        playCount: 1000,
        shareCount: 7,
        createTimeISO: "2026-09-02T08:00:00.000Z",
        authorMeta: { fans: 4200 },
      },
      tt,
      { platform: "tiktok", handle: "acme" },
    );
    expect(doc?.metrics).toEqual({
      likes: 50,
      comments: 2,
      views: 1000,
      shares: 7,
      followers: 4200,
      postedAt: "2026-09-02T08:00:00.000Z",
    });
  });

  it("maps an Instagram profile to bio + followers", () => {
    const doc = mapSocialItem(
      { url: "https://www.instagram.com/acme/", fullName: "Acme", biography: "We make things", followersCount: 9000 },
      target({ kind: "social_profile", value: "instagram:@acme" }),
      { platform: "instagram", handle: "acme" },
    );
    expect(doc?.body).toBe("Acme — We make things");
    expect(doc?.metrics).toEqual({ followers: 9000 });
  });

  it("never turns an actor error item or an empty item into a document", () => {
    const ref = { platform: "instagram", handle: "acme" } as const;
    expect(mapSocialItem({ error: "not found" }, ig, ref)).toBeNull();
    expect(mapSocialItem({ errorDescription: "blocked" }, ig, ref)).toBeNull();
    expect(mapSocialItem({ url: "https://www.instagram.com/p/C/", caption: "  " }, ig, ref)).toBeNull();
  });
});

describe("planTarget memory (Apify free plan shares 8 GB across the account)", () => {
  it("asks a cheerio crawl for 1 GB so several runs fit, and a rendered crawl for the 4 GB it needs", async () => {
    const { CHEERIO_MEMORY_MB, PLAYWRIGHT_MEMORY_MB } = await import("./actors");
    expect(planTarget(target({}), 1).memoryMb).toBe(CHEERIO_MEMORY_MB);
    expect(CHEERIO_MEMORY_MB).toBeLessThanOrEqual(1024);
    expect(planTarget(target({ renderJs: true }), 1).memoryMb).toBe(PLAYWRIGHT_MEMORY_MB);
  });

  it("leaves other actors on their own defaults", () => {
    expect(planTarget(target({ kind: "social_posts", value: "instagram:@acme" }), 3).memoryMb).toBeUndefined();
  });
});
