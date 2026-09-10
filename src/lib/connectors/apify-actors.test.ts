import { describe, expect, it } from "vitest";
import {
  postsActor,
  reelsActor,
  profileActor,
  commentsActor,
  deepPostActor,
  resolveActorSlug,
} from "./apify-actors";

describe("postsActor", () => {
  it("builds input with directUrls for handle-based scraping", () => {
    const input = postsActor.buildInput({
      directUrls: ["https://www.instagram.com/aurora.skincare/"],
      resultsLimit: 30,
    });
    expect(input).toEqual({
      directUrls: ["https://www.instagram.com/aurora.skincare/"],
      resultsType: "posts",
      resultsLimit: 30,
    });
  });

  it("builds input with hashtags", () => {
    const input = postsActor.buildInput({
      hashtags: ["skincare"],
      resultsLimit: 50,
    });
    expect(input).toEqual({
      hashtags: ["skincare"],
      resultsType: "posts",
      resultsLimit: 50,
    });
  });

  it("maps raw items to PatternPostItem, skipping items without timestamps", () => {
    const raw = [
      {
        id: "abc123",
        caption: "Launch post",
        timestamp: "2026-06-20T10:00:00.000Z",
        likesCount: 512,
        commentsCount: 33,
        type: "Video",
      },
      { id: "no-date", caption: "Missing date" },
    ];
    const mapped = postsActor.mapOutput(raw);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({
      externalId: "abc123",
      caption: "Launch post",
      format: "video",
      likes: 512,
      comments: 33,
    });
    expect(mapped[0].postedAt.getUTCFullYear()).toBe(2026);
  });
});

describe("reelsActor", () => {
  it("builds input for reel scraping", () => {
    const input = reelsActor.buildInput({
      username: ["competitor"],
      resultsLimit: 20,
    });
    expect(input).toEqual({
      username: ["competitor"],
      resultsLimit: 20,
    });
  });

  it("maps reel items with format=reel and uses videoPlayCount for views", () => {
    const raw = [
      {
        id: "reel1",
        caption: "Trending reel",
        timestamp: "2026-07-01T12:00:00Z",
        likesCount: 1200,
        commentsCount: 85,
        videoPlayCount: 50000,
        videoViewCount: 45000,
        type: "Reel",
      },
    ];
    const mapped = reelsActor.mapOutput(raw);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({
      externalId: "reel1",
      format: "reel",
      views: 50000, // videoPlayCount preferred over videoViewCount
    });
  });
});

describe("profileActor", () => {
  it("builds input with usernames", () => {
    const input = profileActor.buildInput({
      usernames: ["aurora.skincare", "rival.brand"],
    });
    expect(input).toEqual({
      usernames: ["aurora.skincare", "rival.brand"],
    });
  });

  it("maps profile data, skipping entries without username", () => {
    const raw = [
      {
        username: "aurora.skincare",
        followersCount: 12500,
        followsCount: 300,
        postsCount: 420,
        biography: "Clean beauty for everyone",
        verified: true,
        businessCategoryName: "Beauty & Cosmetics",
        profilePicUrl: "https://example.com/pic.jpg",
        externalUrl: "https://aurora-skincare.com",
      },
      { followersCount: 100 }, // no username → skipped
    ];
    const mapped = profileActor.mapOutput(raw);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({
      handle: "aurora.skincare",
      followers: 12500,
      following: 300,
      postsCount: 420,
      bio: "Clean beauty for everyone",
      isVerified: true,
      businessCategory: "Beauty & Cosmetics",
    });
  });
});

describe("commentsActor", () => {
  it("builds input with directUrls and limit", () => {
    const input = commentsActor.buildInput({
      directUrls: ["https://www.instagram.com/p/abc123/"],
      resultsLimit: 20,
    });
    expect(input).toEqual({
      directUrls: ["https://www.instagram.com/p/abc123/"],
      resultsLimit: 20,
    });
  });

  it("maps comment data, skipping entries without text or timestamp", () => {
    const raw = [
      {
        id: "c1",
        ownerUsername: "fan1",
        text: "Love this!",
        likesCount: 5,
        timestamp: "2026-07-01T08:00:00Z",
      },
      { id: "c2", ownerUsername: "fan2", likesCount: 1 }, // no text → skipped
      {
        id: "c3",
        text: "Great content",
        timestamp: "invalid-date",
      }, // bad date → skipped
    ];
    const mapped = commentsActor.mapOutput(raw);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({
      authorHandle: "fan1",
      text: "Love this!",
      likes: 5,
    });
  });
});

describe("deepPostActor", () => {
  it("builds input for deep post fetch", () => {
    const input = deepPostActor.buildInput({
      username: ["xyz789"],
      resultsLimit: 1,
    });
    expect(input).toEqual({
      username: ["xyz789"],
      resultsLimit: 1,
    });
  });

  it("maps deep post items identically to postsActor", () => {
    const raw = [
      {
        id: "xyz789",
        caption: "Deep dive post",
        timestamp: "2026-07-10T09:00:00Z",
        likesCount: 800,
        commentsCount: 42,
        type: "Carousel",
      },
    ];
    const mapped = deepPostActor.mapOutput(raw);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({
      externalId: "xyz789",
      format: "carousel",
      likes: 800,
      comments: 42,
    });
  });
});

describe("resolveActorSlug", () => {
  it("returns the default slug when no env override exists", () => {
    expect(resolveActorSlug("posts")).toBe("apify~instagram-scraper");
    expect(resolveActorSlug("reels")).toBe("apify~instagram-reel-scraper");
    expect(resolveActorSlug("profile")).toBe(
      "apify~instagram-profile-scraper",
    );
    expect(resolveActorSlug("comments")).toBe(
      "apify~instagram-comment-scraper",
    );
    expect(resolveActorSlug("deep_post")).toBe(
      "apify~instagram-post-scraper",
    );
  });
});
