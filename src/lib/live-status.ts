/**
 * Pure formatting/threshold logic for the "live" visual grammar the
 * 2026-08-17 audit found missing everywhere real-time actually works.
 * Time is passed in explicitly, never read from Date.now() here, so
 * callers (and tests) control the clock.
 */

const RECENT_MS = 4_000;
const JUST_NOW_MS = 5_000;

export function isRecentlyUpdated(
  lastSignalAtMs: number | null,
  nowMs: number,
): boolean {
  if (lastSignalAtMs === null) return false;
  return nowMs - lastSignalAtMs < RECENT_MS;
}

export function formatUpdatedAgo(
  lastSignalAtMs: number | null,
  nowMs: number,
): string {
  if (lastSignalAtMs === null) return "";
  const deltaMs = Math.max(0, nowMs - lastSignalAtMs);
  if (deltaMs < JUST_NOW_MS) return "updated just now";
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return `updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `updated ${hours}h ago`;
}
