/**
 * Catch-up rule for scheduled Platina jobs: after the job runner was down,
 * a cron runs once, not once per missed tick.
 *
 * The Inngest runner replays every tick it missed while stopped, back to back
 * on start-up (inngest/inngest#5217, draining within ~1-5 minutes of boot).
 * For collection that can spend most of a day's cap in minutes, and every
 * replay repeats the same work. A cron run is skipped when another run of the
 * same job started less than `minGapMs` ago.
 *
 * `BURST_WINDOW_MS` (15 min) is the default for hourly/daily/weekly/monthly
 * jobs: long enough to swallow the entire start-up replay burst, short enough
 * that a transient step failure on the first run never locks out a second
 * attempt later in the day.
 *
 * Event-triggered runs (a person's request, a follow-up event) are never
 * skipped. State lives in process memory (one local process, CLAUDE.md
 * 2026-10-15) and is kept on globalThis across dev-server module reloads.
 */
export const CRON_EVENT = "inngest/scheduled.timer";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const BURST_WINDOW_MS = 15 * MINUTE;

type Claim = { runId: string; at: number };

const globalStore = globalThis as typeof globalThis & {
  __platinaCronClaims?: Map<string, Claim>;
};

function defaultStore(): Map<string, Claim> {
  globalStore.__platinaCronClaims ??= new Map();
  return globalStore.__platinaCronClaims;
}

/**
 * True when this run should stop before doing any work. The same run is
 * re-invoked once per step, so a claim held by `runId` itself always passes.
 */
export function isReplayedTick(
  input: { jobId: string; eventName: string | undefined; runId: string; minGapMs?: number },
  now = Date.now(),
  store: Map<string, Claim> = defaultStore(),
): boolean {
  if (input.eventName !== CRON_EVENT) return false;
  const minGapMs = input.minGapMs ?? BURST_WINDOW_MS;
  const claim = store.get(input.jobId);
  if (claim && claim.runId === input.runId) return false;
  if (claim && now - claim.at < minGapMs) return true;
  store.set(input.jobId, { runId: input.runId, at: now });
  return false;
}

export const REPLAYED_TICK = { skipped: "replayed tick after the job runner was down" } as const;
