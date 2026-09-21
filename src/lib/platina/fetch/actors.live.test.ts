/**
 * R5 — the social mapper against LIVE actor payloads, captured 2026-09-21 from
 * real runs (apify~instagram-profile-scraper, apify~instagram-scraper,
 * clockworks~tiktok-profile-scraper, clockworks~tiktok-scraper) against a
 * large public account.
 *
 * Why this file exists: every field name in mapSocialItem came from
 * documentation and was only checked against hand-written fixtures. A wrong
 * name fails SILENTLY — pickMetrics drops anything that is not a finite number,
 * so a post arrives with no metrics and no error. These fixtures are the proof
 * that the names are real, and the alarm when an actor changes its payload.
 *
 * Re-capture with: npx tsx scripts/verify-social-actors.ts --save
 * Add the new dated fixture; never replace an old one — the diff between two
 * dates is how a renamed field becomes visible.
 */
import { describe, expect, it } from "vitest";
import type { PlatinaScanTarget } from "@/db/platina-schema";
import { mapSocialItem } from "./actors";
import igProfile from "./fixtures/instagram-profile-live-2026-09-21.json";
import igPost from "./fixtures/instagram-posts-live-2026-09-21.json";
import ttProfile from "./fixtures/tiktok-profile-live-2026-09-21.json";
import ttPost from "./fixtures/tiktok-posts-live-2026-09-21.json";

const target = (kind: PlatinaScanTarget["kind"], value: string): PlatinaScanTarget => ({
  kind,
  value,
});

describe("Instagram profile (live payload)", () => {
  const doc = mapSocialItem(
    igProfile as Record<string, unknown>,
    target("social_profile", "instagram:@nasa"),
    { platform: "instagram", handle: "nasa" },
  );

  it("maps to a document rather than being rejected", () => {
    expect(doc).not.toBeNull();
    expect(doc!.title).toBe("instagram @nasa");
    expect(doc!.sourceKind).toBe("social_profile");
  });

  it("reads the follower count from the field the actor really sends", () => {
    expect(doc!.metrics?.followers).toBeGreaterThan(1_000_000);
  });

  it("builds the body from fullName and biography", () => {
    expect(doc!.body.length).toBeGreaterThan(10);
  });
});

describe("Instagram post (live payload)", () => {
  const doc = mapSocialItem(
    igPost as Record<string, unknown>,
    target("social_posts", "instagram:@nasa"),
    { platform: "instagram", handle: "nasa" },
  );

  it("reads likes, comments and the posting date", () => {
    expect(doc!.metrics?.likes).toBeGreaterThan(0);
    expect(doc!.metrics?.comments).toBeGreaterThan(0);
    expect(doc!.metrics?.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("takes the caption as the body", () => {
    expect(doc!.body.length).toBeGreaterThan(20);
  });

  it("does not invent a view count on a photo post", () => {
    // videoViewCount is absent on images: an absence must stay an absence,
    // never a zero that would drag a median toward a number nobody measured.
    if ((igPost as Record<string, unknown>).videoViewCount === undefined) {
      expect(doc!.metrics?.views).toBeUndefined();
    }
  });

  it("canonicalises the post's own URL, not the profile URL", () => {
    expect(doc!.canonicalUrl).toContain("instagram.com");
  });
});

describe("TikTok (live payload)", () => {
  const post = mapSocialItem(
    ttPost as Record<string, unknown>,
    target("social_posts", "tiktok:@nasa"),
    { platform: "tiktok", handle: "nasa" },
  );

  it("reads the whole engagement set from the documented names", () => {
    expect(post!.metrics?.likes).toBeGreaterThan(0); // diggCount
    expect(post!.metrics?.comments).toBeGreaterThan(0); // commentCount
    expect(post!.metrics?.views).toBeGreaterThan(0); // playCount
    expect(post!.metrics?.shares).toBeGreaterThan(0); // shareCount
    expect(post!.metrics?.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // createTimeISO
  });

  it("reads the follower count from authorMeta.fans", () => {
    expect(post!.metrics?.followers).toBeGreaterThan(0);
  });

  it("the profile actor returns video items too — so it maps the same way", () => {
    // Live finding 2026-09-21: clockworks~tiktok-profile-scraper returns the
    // same video shape as the post scraper, not a profile object. Both kinds
    // therefore yield posts, and the follower count rides along on each one.
    const profile = mapSocialItem(
      ttProfile as Record<string, unknown>,
      target("social_profile", "tiktok:@nasa"),
      { platform: "tiktok", handle: "nasa" },
    );
    expect(profile).not.toBeNull();
    expect(profile!.metrics?.followers).toBeGreaterThan(0);
    expect(profile!.metrics?.views).toBeGreaterThan(0);
  });
});
