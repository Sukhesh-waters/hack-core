/**
 * LinkedIn company posts (slice C2), against the live fixture captured in C0
 * (2026-09-21, harvestapi/linkedin-company-posts, Thermo Fisher Scientific).
 */
import { describe, expect, it } from "vitest";
import livePosts from "./fixtures/linkedin-posts-live-2026-09-21.json";
import { LINKEDIN_POSTS_ACTOR, mapSocialItem, parseSocialRef, planTarget } from "./actors";
import { isDue, type SchedulableSpec } from "./schedule";
import {
  LINKEDIN_CADENCE_MINUTES,
  candidatesToSpecs,
  deriveSources,
  normalizeLinkedInCompany,
} from "../onboard/derive";

describe("LinkedIn company references", () => {
  it("accepts slugs, @slugs and company URLs; refuses a person's profile", () => {
    expect(normalizeLinkedInCompany("waters")).toBe("waters");
    expect(normalizeLinkedInCompany("@Thermo-Fisher-Scientific")).toBe("thermo-fisher-scientific");
    expect(normalizeLinkedInCompany("https://www.linkedin.com/company/waters/posts/?feedView=all")).toBe("waters");
    expect(normalizeLinkedInCompany("https://www.linkedin.com/in/satyanadella/")).toBeNull();
    expect(normalizeLinkedInCompany("")).toBeNull();
  });

  it("parses linkedin:@slug and company URLs as a social ref", () => {
    expect(parseSocialRef("linkedin:@waters")).toEqual({ platform: "linkedin", handle: "waters" });
    expect(parseSocialRef("https://www.linkedin.com/company/thermo-fisher-scientific/")).toEqual({
      platform: "linkedin",
      handle: "thermo-fisher-scientific",
    });
    expect(parseSocialRef("https://www.linkedin.com/in/someone/")).toBeNull();
  });
});

describe("LinkedIn collection plan", () => {
  it("asks the verified actor for one company's own posts from the last month", () => {
    const plan = planTarget({ kind: "social_posts", value: "linkedin:@waters", maxPages: 10 }, 10);
    expect(plan.actor).toBe(LINKEDIN_POSTS_ACTOR);
    expect(plan.input).toEqual({
      targetUrls: ["https://www.linkedin.com/company/waters/"],
      maxPosts: 10,
      postedLimit: "month",
      includeReposts: false,
      includeQuotePosts: true,
    });
  });

  it("refuses a LinkedIn 'profile' source — company posts only", () => {
    expect(() => planTarget({ kind: "social_profile", value: "linkedin:@waters" }, 1)).toThrow(/company posts only/);
  });

  it("onboarding offers it weekly, named for people", () => {
    const [c] = deriveSources({ homepageUrl: "", handles: { linkedin: "linkedin.com/company/waters" } });
    expect(c).toMatchObject({ kind: "social_posts", value: "linkedin:@waters", cadenceMinutes: LINKEDIN_CADENCE_MINUTES });
    expect(candidatesToSpecs("Waters", [c], false)[0].name).toBe("Waters · linkedin posts");
  });
});

describe("LinkedIn post mapping (live fixture)", () => {
  const target = { kind: "social_posts" as const, value: "linkedin:@thermo-fisher-scientific" };
  const ref = { platform: "linkedin" as const, handle: "thermo-fisher-scientific" };
  const docs = (livePosts as Record<string, unknown>[]).map((item) => mapSocialItem(item, target, ref));

  it("keeps the post's words and its engagement as metrics", () => {
    const doc = docs[0]!;
    expect(doc.body.length).toBeGreaterThan(40);
    expect(doc.title).toBe("linkedin Thermo Fisher Scientific");
    expect(doc.metrics?.likes).toBeGreaterThan(0);
    expect(typeof doc.metrics?.comments).toBe("number");
    expect(typeof doc.metrics?.shares).toBe("number");
    expect(doc.metrics?.postedAt).toMatch(/^2026-09-/);
    expect(doc.canonicalUrl).toMatch(/linkedin\.com/);
  });

  it("stores a small raw record — no reaction/comment id lists, no images", () => {
    expect(Object.keys(docs[0]!.raw as object).sort()).toEqual(["author", "engagement", "id", "linkedinUrl", "postedAt"]);
  });

  it("a post with no words is not a document", () => {
    expect(mapSocialItem({ content: "  ", engagement: { likes: 5 } }, target, ref)).toBeNull();
  });
});

describe("cadence is a floor for sources without a probe", () => {
  const NOW = new Date("2026-09-21T12:00:00Z");
  const spec = (cadenceMinutes: number, lastSuccessHoursAgo: number): SchedulableSpec => ({
    id: "s",
    enabled: true,
    status: "approved",
    cadenceMinutes,
    lastProbeAt: null,
    lastSuccessAt: new Date(NOW.getTime() - lastSuccessHoursAgo * 3_600_000),
    currentIntervalMinutes: null,
    consecutiveUnchanged: 0,
    fetchesDay: null,
    fetchesToday: 0,
  });

  it("a weekly LinkedIn source is not re-run after 7 hours (it used to be, at the 6-hour start)", () => {
    expect(isDue(spec(LINKEDIN_CADENCE_MINUTES, 7), false, NOW)).toBe(false);
    expect(isDue(spec(LINKEDIN_CADENCE_MINUTES, 24 * 7 + 1), false, NOW)).toBe(true);
  });

  it("a daily ad-library source waits a day", () => {
    expect(isDue(spec(24 * 60, 7), false, NOW)).toBe(false);
    expect(isDue(spec(24 * 60, 25), false, NOW)).toBe(true);
  });
});

describe("one-time LinkedIn backfill", () => {
  it("reaches back further and asks for more posts, only while the flag is set", async () => {
    const { planTarget, effectivePages } = await import("./actors");
    const weekly = { kind: "social_posts" as const, value: "linkedin:@waters", maxPages: 10 };
    const backfill = { ...weekly, backfill: { lookback: "3months" as const, posts: 30 } };
    expect(planTarget(weekly, effectivePages(weekly, undefined)).input).toMatchObject({ postedLimit: "month", maxPosts: 10 });
    expect(planTarget(backfill, effectivePages(backfill, undefined)).input).toMatchObject({ postedLimit: "3months", maxPosts: 25 }); // MAX_PAGES_CEILING
  });

  it("still obeys the page budget", async () => {
    const { effectivePages } = await import("./actors");
    expect(
      effectivePages({ maxPages: 10, backfill: { lookback: "3months", posts: 30 } }, 12),
    ).toBe(12);
  });
});
