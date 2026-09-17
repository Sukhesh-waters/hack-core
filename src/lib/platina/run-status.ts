/**
 * Audit-run state machine and freshness logic. Pure — no I/O, no imports
 * beyond types. The DB layer enforces these transitions with a guarded
 * update (`transitionAuditRun`); this module is the single definition both
 * sides test against.
 */

export const RUN_STATUSES = [
  "queued",
  "running",
  "validating",
  "completed",
  "degraded",
  "failed",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL_STATUSES: readonly RunStatus[] = [
  "completed",
  "degraded",
  "failed",
];

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Legal transitions. Terminal states have none — a finished run never
 * reopens; a retry creates a new run with a new idempotency key.
 */
export const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  queued: ["running", "failed"],
  running: ["validating", "degraded", "failed"],
  validating: ["completed", "degraded", "failed"],
  completed: [],
  degraded: [],
  failed: [],
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

/** Non-terminal statuses a worker may legally pick up. */
export const PICKABLE_STATUSES: readonly RunStatus[] = ["queued"];

export type Freshness = "fresh" | "stale" | "unknown";

/** Default staleness window: three missed 5-minute cadence ticks. */
export const DEFAULT_STALE_AFTER_MS = 15 * 60_000;

export function freshnessState(
  lastSuccessAt: Date | null,
  now = new Date(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
): Freshness {
  if (!lastSuccessAt) return "unknown";
  return now.getTime() - lastSuccessAt.getTime() <= staleAfterMs
    ? "fresh"
    : "stale";
}
