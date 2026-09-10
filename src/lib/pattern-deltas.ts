/**
 * Pattern-layer-only data. `profileDeltas` turns raw pattern_profiles
 * snapshots (public, Apify-sourced competitor handles) into follower/post
 * growth deltas for display on the KB pattern surface. This never touches
 * the first-party baseline/scoring engine and must never be cited in a
 * "why this idea" explanation — two-layer rule (CLAUDE.md).
 */

export type ProfileSnapshot = {
  handle: string;
  followers: number;
  postsCount: number;
  takenAt: Date;
};

export type ProfileDelta =
  | {
      handle: string;
      followers: number;
      followerDelta: number;
      postsDelta: number;
      since: Date;
    }
  | {
      handle: string;
      followers: number;
      single: true;
    };

/**
 * Group snapshots by handle and compute the delta between the latest and
 * previous snapshot (by takenAt). A handle with exactly one snapshot has no
 * prior point of comparison, so it returns the `single: true` shape —
 * never a fabricated 0 delta or fake trend (same honesty principle as the
 * min-N gate, applied to the pattern layer). Output is sorted by handle
 * ascending for stable rendering.
 */
export function profileDeltas(snapshots: ProfileSnapshot[]): ProfileDelta[] {
  const byHandle = new Map<string, ProfileSnapshot[]>();
  for (const snap of snapshots) {
    const list = byHandle.get(snap.handle);
    if (list) {
      list.push(snap);
    } else {
      byHandle.set(snap.handle, [snap]);
    }
  }

  const results: ProfileDelta[] = [];
  for (const [handle, list] of byHandle) {
    const sorted = [...list].sort(
      (a, b) => b.takenAt.getTime() - a.takenAt.getTime(),
    );
    const [latest, previous] = sorted;

    if (!previous) {
      results.push({ handle, followers: latest.followers, single: true });
      continue;
    }

    results.push({
      handle,
      followers: latest.followers,
      followerDelta: latest.followers - previous.followers,
      postsDelta: latest.postsCount - previous.postsCount,
      since: previous.takenAt,
    });
  }

  return results.sort((a, b) => a.handle.localeCompare(b.handle));
}
