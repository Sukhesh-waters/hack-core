import { describe, expect, it } from "vitest";
import { profileDeltas, type ProfileSnapshot } from "./pattern-deltas";

function snap(
  handle: string,
  followers: number,
  postsCount: number,
  takenAt: string,
): ProfileSnapshot {
  return { handle, followers, postsCount, takenAt: new Date(takenAt) };
}

describe("profileDeltas", () => {
  it("computes followerDelta/postsDelta/since from two snapshots", () => {
    const result = profileDeltas([
      snap("competitor", 1000, 50, "2026-07-01"),
      snap("competitor", 1200, 55, "2026-07-15"),
    ]);
    expect(result).toEqual([
      {
        handle: "competitor",
        followers: 1200,
        followerDelta: 200,
        postsDelta: 5,
        since: new Date("2026-07-01"),
      },
    ]);
  });

  it("returns single:true with no delta fields for one snapshot", () => {
    const result = profileDeltas([snap("onlyone", 500, 10, "2026-07-10")]);
    expect(result).toEqual([
      { handle: "onlyone", followers: 500, single: true },
    ]);
    expect(result[0]).not.toHaveProperty("followerDelta");
    expect(result[0]).not.toHaveProperty("postsDelta");
    expect(result[0]).not.toHaveProperty("since");
  });

  it("uses only the latest two snapshots when three exist", () => {
    const result = profileDeltas([
      snap("three", 100, 5, "2026-06-01"),
      snap("three", 300, 8, "2026-07-01"),
      snap("three", 350, 9, "2026-07-15"),
    ]);
    expect(result).toEqual([
      {
        handle: "three",
        followers: 350,
        followerDelta: 50,
        postsDelta: 1,
        since: new Date("2026-07-01"),
      },
    ]);
  });

  it("supports negative deltas (follower/post loss)", () => {
    const result = profileDeltas([
      snap("shrinking", 900, 40, "2026-07-01"),
      snap("shrinking", 850, 38, "2026-07-15"),
    ]);
    expect(result).toEqual([
      {
        handle: "shrinking",
        followers: 850,
        followerDelta: -50,
        postsDelta: -2,
        since: new Date("2026-07-01"),
      },
    ]);
  });

  it("groups correctly regardless of input order", () => {
    const result = profileDeltas([
      snap("b_handle", 200, 20, "2026-07-15"),
      snap("a_handle", 100, 10, "2026-07-01"),
      snap("b_handle", 150, 18, "2026-07-01"),
      snap("a_handle", 120, 11, "2026-07-10"),
    ]);
    expect(result.map((r) => r.handle)).toEqual(["a_handle", "b_handle"]);
    expect(result[0]).toMatchObject({ followerDelta: 20, postsDelta: 1 });
    expect(result[1]).toMatchObject({ followerDelta: 50, postsDelta: 2 });
  });

  it("sorts output by handle ascending", () => {
    const result = profileDeltas([
      snap("zeta", 10, 1, "2026-07-01"),
      snap("alpha", 20, 2, "2026-07-01"),
      snap("mid", 30, 3, "2026-07-01"),
    ]);
    expect(result.map((r) => r.handle)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("returns an empty array for no snapshots", () => {
    expect(profileDeltas([])).toEqual([]);
  });
});
