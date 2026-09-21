/**
 * Cadence and adaptive-schedule logic for audit sources (R1). Pure.
 *
 * Probed kinds run the cheap header probe on the configured cadence; actor
 * fetches fire only on change. Probe-less kinds use an adaptive interval:
 * 6-hour start, halving toward the configured floor as changes are observed,
 * doubling on consecutive unchanged fetches up to a 24-hour cap.
 */

import {
  DAILY_CAP_REASON,
  PAGES_PER_SOURCE_DAY,
  SOURCE_CAP_REASON,
} from "./budget";

export const ADAPTIVE_START_MINUTES = 360;
export const ADAPTIVE_MAX_MINUTES = 24 * 60;
/**
 * Cost cap: pages collected per source per UTC day (a page, not a run).
 * Owned by budget.ts, which holds every spend number and the assertions that
 * keep them composing; re-exported here for the callers that already read it.
 */
export const MAX_FETCHES_PER_DAY = PAGES_PER_SOURCE_DAY;

export type SchedulableSpec = {
  id: string;
  enabled: boolean;
  status: string;
  cadenceMinutes: number;
  // Inngest step results serialize dates to strings; both are accepted.
  lastProbeAt: Date | string | null;
  lastSuccessAt: Date | string | null;
  currentIntervalMinutes: number | null;
  consecutiveUnchanged: number;
  fetchesDay: string | null;
  fetchesToday: number;
};

/** Kinds with a usable cheap probe signal (verified in the actor matrix). */
export const PROBE_CAPABLE_KINDS = new Set(["competitor_site"]);

export function isProbeCapable(kind: string): boolean {
  return PROBE_CAPABLE_KINDS.has(kind);
}

/**
 * Deterministic per-spec jitter (0–4 minutes) derived from the spec id, so a
 * fleet of 5-minute sources does not thunder-herd on the cron tick.
 */
export function jitterMinutes(specId: string): number {
  let hash = 0;
  for (let i = 0; i < specId.length; i++) {
    hash = (hash * 31 + specId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 5;
}

function addMinutes(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

/**
 * The next moment a source deserves attention. Probe-capable sources probe on
 * cadence; probe-less sources fetch on the adaptive interval. Both are
 * measured from the last activity of the relevant kind.
 */
export function nextDueAt(
  spec: SchedulableSpec,
  probeCapable: boolean,
): Date {
  const jitter = jitterMinutes(spec.id);
  if (probeCapable) {
    const base =
      toDate(spec.lastProbeAt) ?? toDate(spec.lastSuccessAt) ?? new Date(0);
    return addMinutes(base, spec.cadenceMinutes + jitter);
  }
  const interval = spec.currentIntervalMinutes ?? ADAPTIVE_START_MINUTES;
  const base =
    toDate(spec.lastSuccessAt) ?? toDate(spec.lastProbeAt) ?? new Date(0);
  return addMinutes(base, interval + jitter);
}

export function isDue(
  spec: SchedulableSpec,
  probeCapable: boolean,
  now = new Date(),
): boolean {
  if (!spec.enabled || spec.status !== "approved") return false;
  return nextDueAt(spec, probeCapable).getTime() <= now.getTime();
}

/** True when the daily cost cap is exhausted (resets each UTC day). */
export function costCapReached(spec: SchedulableSpec, now = new Date()): boolean {
  const today = now.toISOString().slice(0, 10);
  if (spec.fetchesDay !== today) return false;
  return spec.fetchesToday >= MAX_FETCHES_PER_DAY;
}

/** Pages this spec may still spend today under its own per-source cap. */
export function specPagesRemaining(spec: SchedulableSpec, now = new Date()): number {
  const today = now.toISOString().slice(0, 10);
  const used = spec.fetchesDay === today ? spec.fetchesToday : 0;
  return Math.max(0, MAX_FETCHES_PER_DAY - used);
}

/**
 * The workspace-wide spend control. Returns how many pages the workspace may
 * still collect today; 0 means "paused until 00:00 UTC".
 */
export function workspacePagesRemaining(
  pagesToday: number,
  dailyCap: number,
): number {
  return Math.max(0, dailyCap - pagesToday);
}

export { DAILY_CAP_REASON, SOURCE_CAP_REASON };

/** Adaptive interval after an unchanged fetch: double, capped at 24 h. */
export function backoffInterval(current: number | null): number {
  return Math.min((current ?? ADAPTIVE_START_MINUTES) * 2, ADAPTIVE_MAX_MINUTES);
}

/** Adaptive interval after a changed fetch: halve toward the cadence floor. */
export function tightenInterval(
  current: number | null,
  cadenceFloor: number,
): number {
  return Math.max(
    Math.floor((current ?? ADAPTIVE_START_MINUTES) / 2),
    cadenceFloor,
  );
}
