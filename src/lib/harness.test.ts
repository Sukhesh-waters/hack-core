import { describe, expect, it } from "vitest";
import {
  actorKeyForSegment,
  clampCap,
  dedupeItems,
  extractCompetitorHandles,
  hasCommentMining,
  HARNESS_DEFAULT_CAP,
  HARNESS_HARD_CAP,
  nextRunDue,
  pickTopPostsForComments,
  profileFetchDue,
  segmentToActorInput,
} from "./harness";

describe("clampCap (budget cap)", () => {
  it("clamps to the hard cap of 100", () => {
    expect(clampCap(500)).toBe(HARNESS_HARD_CAP);
    expect(clampCap(100)).toBe(100);
    expect(clampCap(30)).toBe(30);
  });

  it("falls back to the default for zero/negative/NaN", () => {
    expect(clampCap(0)).toBe(HARNESS_DEFAULT_CAP);
    expect(clampCap(-5)).toBe(HARNESS_DEFAULT_CAP);
    expect(clampCap(Number.NaN)).toBe(HARNESS_DEFAULT_CAP);
  });
});

describe("segmentToActorInput", () => {
  it("competitor_handle → directUrls, @ stripped", () => {
    const input = segmentToActorInput({
      kind: "competitor_handle",
      value: "@aurora.skincare",
    });
    expect(input.directUrls).toEqual([
      "https://www.instagram.com/aurora.skincare/",
    ]);
  });

  it("hashtag → hashtags mode, # stripped and normalized", () => {
    const input = segmentToActorInput({ kind: "hashtag", value: "#SkinCare" });
    expect(input.hashtags).toEqual(["skincare"]);
  });

  it("niche_query → hashtag-ified query", () => {
    const input = segmentToActorInput({
      kind: "niche_query",
      value: "barrier repair routines",
    });
    expect(input.hashtags).toEqual(["barrierrepairroutines"]);
  });

  it("competitor_handle + target=reels → username[], not directUrls", () => {
    const input = segmentToActorInput({
      kind: "competitor_handle",
      value: "@rival",
      target: "reels",
    });
    expect(input).toEqual({ username: ["rival"] });
    expect(input.directUrls).toBeUndefined();
  });
});

describe("actorKeyForSegment (A2: reels routing)", () => {
  it("defaults to 'posts' when no target specified", () => {
    expect(
      actorKeyForSegment({ kind: "competitor_handle", value: "rival" }),
    ).toBe("posts");
    expect(actorKeyForSegment({ kind: "hashtag", value: "skincare" })).toBe(
      "posts",
    );
  });

  it("returns 'posts' when target is explicitly 'posts'", () => {
    expect(
      actorKeyForSegment({
        kind: "competitor_handle",
        value: "rival",
        target: "posts",
      }),
    ).toBe("posts");
  });

  it("returns 'reels' when target is 'reels'", () => {
    expect(
      actorKeyForSegment({
        kind: "competitor_handle",
        value: "rival",
        target: "reels",
      }),
    ).toBe("reels");
    expect(
      actorKeyForSegment({
        kind: "hashtag",
        value: "trending",
        target: "reels",
      }),
    ).toBe("reels");
  });
});

describe("nextRunDue", () => {
  const now = new Date("2026-07-08T10:00:00Z");

  it("never due when disabled or manual", () => {
    expect(
      nextRunDue({ enabled: false, cadence: "daily", lastRunAt: null }, now),
    ).toBe(false);
    expect(
      nextRunDue({ enabled: true, cadence: "manual", lastRunAt: null }, now),
    ).toBe(false);
  });

  it("due immediately when enabled and never run", () => {
    expect(
      nextRunDue({ enabled: true, cadence: "daily", lastRunAt: null }, now),
    ).toBe(true);
  });

  it("daily: due after 24h, not before", () => {
    const rule = {
      enabled: true,
      cadence: "daily" as const,
      lastRunAt: new Date("2026-07-07T10:00:00Z"),
    };
    expect(nextRunDue(rule, now)).toBe(true);
    expect(
      nextRunDue(
        { ...rule, lastRunAt: new Date("2026-07-07T11:00:00Z") },
        now,
      ),
    ).toBe(false);
  });

  it("weekly: due after 7 days", () => {
    const rule = { enabled: true, cadence: "weekly" as const };
    expect(
      nextRunDue(
        { ...rule, lastRunAt: new Date("2026-07-01T09:00:00Z") },
        now,
      ),
    ).toBe(true);
    expect(
      nextRunDue(
        { ...rule, lastRunAt: new Date("2026-07-03T10:00:00Z") },
        now,
      ),
    ).toBe(false);
  });
});

describe("dedupeItems (per-workspace external id dedupe)", () => {
  it("drops items whose external id the workspace already has", () => {
    const items = [
      { externalId: "a", caption: "one" },
      { externalId: "b", caption: "two" },
      { externalId: "a", caption: "dupe-in-batch" },
      { caption: "no-id" },
    ];
    const out = dedupeItems(items, ["b"]);
    expect(out.map((i) => i.caption)).toEqual(["one", "no-id"]);
  });
});

describe("profileFetchDue (A3)", () => {
  const now = new Date("2026-07-08T10:00:00Z");

  it("due when never fetched", () => {
    expect(profileFetchDue(null, now)).toBe(true);
  });

  it("due after 24h", () => {
    expect(
      profileFetchDue(new Date("2026-07-07T09:00:00Z"), now),
    ).toBe(true);
  });

  it("not due within 24h", () => {
    expect(
      profileFetchDue(new Date("2026-07-07T11:00:00Z"), now),
    ).toBe(false);
  });
});

describe("extractCompetitorHandles (A3)", () => {
  it("extracts unique handles, strips @", () => {
    const segments = [
      { kind: "competitor_handle" as const, value: "@aurora" },
      { kind: "hashtag" as const, value: "#skincare" },
      { kind: "competitor_handle" as const, value: "@aurora" },
      { kind: "competitor_handle" as const, value: "rival" },
    ];
    expect(extractCompetitorHandles(segments).sort()).toEqual([
      "aurora",
      "rival",
    ]);
  });
});

describe("pickTopPostsForComments (A4)", () => {
  it("picks top N posts by likes, skipping those without externalId", () => {
    const posts = [
      { externalId: "a", likes: 10 },
      { externalId: "b", likes: 50 },
      { likes: 100 }, // no externalId → excluded
      { externalId: "c", likes: 30 },
      { externalId: "d", likes: 5 },
    ];
    const top = pickTopPostsForComments(posts, 2);
    expect(top.map((p) => p.externalId)).toEqual(["b", "c"]);
  });
});

describe("hasCommentMining (A4)", () => {
  it("returns false when no segments have mineComments", () => {
    expect(
      hasCommentMining([
        { kind: "hashtag", value: "skincare" },
        { kind: "competitor_handle", value: "rival" },
      ]),
    ).toBe(false);
  });

  it("returns true when at least one segment has mineComments", () => {
    expect(
      hasCommentMining([
        { kind: "hashtag", value: "skincare" },
        { kind: "competitor_handle", value: "rival", mineComments: true },
      ]),
    ).toBe(true);
  });
});
