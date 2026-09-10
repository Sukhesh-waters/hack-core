import type { ProductionStage } from "@/lib/production";

/**
 * W1 — the seeded default workflow, defined to mirror `lib/production.ts`
 * EXACTLY.
 *
 * This file is the bridge between the old hardcoded world and the new
 * runtime one. Every state below carries the `production_stage` enum value
 * it replaces, and the transition list is a transcription of the old
 * TRANSITIONS map — same sources, same targets, same verbs. That fidelity
 * is the acceptance test for the whole migration: a workspace that never
 * customises must see a pixel-identical product, so anything that drifts
 * here is a regression, not a design choice.
 *
 * Once W3 lands and boards render from the DB, this file stops being the
 * runtime source of truth and becomes only what new workspaces start from.
 */

/** Static, fully-written Tailwind classes. The JIT scans source text, so a
 *  stored colour is a KEY into this map, never an interpolated class. */
export const WORKFLOW_STATE_COLORS = {
  slate: { chip: "bg-slate-400/15 text-slate-300", dot: "bg-slate-400" },
  sky: { chip: "bg-sky-400/15 text-sky-300", dot: "bg-sky-400" },
  amber: { chip: "bg-amber-400/15 text-amber-300", dot: "bg-amber-400" },
  rose: { chip: "bg-rose-400/15 text-rose-300", dot: "bg-rose-400" },
  emerald: { chip: "bg-emerald-400/15 text-emerald-300", dot: "bg-emerald-400" },
  violet: { chip: "bg-violet-400/15 text-violet-300", dot: "bg-violet-400" },
  teal: { chip: "bg-teal-400/15 text-teal-300", dot: "bg-teal-400" },
  zinc: { chip: "bg-zinc-400/15 text-zinc-300", dot: "bg-zinc-400" },
} as const;

export type WorkflowColorKey = keyof typeof WORKFLOW_STATE_COLORS;

export function isWorkflowColorKey(value: string): value is WorkflowColorKey {
  return value in WORKFLOW_STATE_COLORS;
}

/** Unknown/legacy colour keys fall back rather than rendering an undefined
 *  class string — a board with one broken column is worse than a dull one. */
export function workflowColor(key: string) {
  return isWorkflowColorKey(key)
    ? WORKFLOW_STATE_COLORS[key]
    : WORKFLOW_STATE_COLORS.slate;
}

export type SeedState = {
  key: string;
  name: string;
  category: "todo" | "doing" | "done";
  colorKey: WorkflowColorKey;
  legacyStage: ProductionStage;
};

export type SeedTransition = {
  /** Null = the initial transition: what a brand-new row adopts. */
  from: string | null;
  to: string;
  name: string;
};

export const CONTENT_WORK_TYPE_KEY = "content";

/** Mirrors productionStage: brief, in_progress, internal_review, revision, done. */
export const DEFAULT_CONTENT_STATES: SeedState[] = [
  {
    key: "brief",
    name: "Brief",
    category: "todo",
    colorKey: "slate",
    legacyStage: "brief",
  },
  {
    key: "in_progress",
    name: "In progress",
    category: "doing",
    colorKey: "sky",
    legacyStage: "in_progress",
  },
  {
    key: "internal_review",
    name: "Internal review",
    category: "doing",
    colorKey: "amber",
    legacyStage: "internal_review",
  },
  {
    key: "revision",
    name: "Revision",
    category: "doing",
    colorKey: "rose",
    legacyStage: "revision",
  },
  {
    key: "done",
    name: "Done",
    category: "done",
    colorKey: "emerald",
    legacyStage: "done",
  },
];

/**
 * Transcribed from lib/production.ts TRANSITIONS. Not a straight line:
 * internal_review has two exits (forward to done, or back to revision), and
 * revision's only exit is back to internal_review. done reopens to
 * in_progress — the done column is a lane, never a sink. Existing
 * workspaces get the reopen edge from migration 0042; this list only
 * reaches workspaces seeded after it shipped.
 */
export const DEFAULT_CONTENT_TRANSITIONS: SeedTransition[] = [
  { from: null, to: "brief", name: "Create" },
  { from: "brief", to: "in_progress", name: "Start" },
  { from: "in_progress", to: "internal_review", name: "Submit for review" },
  { from: "internal_review", to: "done", name: "Mark done" },
  { from: "internal_review", to: "revision", name: "Send back" },
  { from: "revision", to: "internal_review", name: "Resubmit" },
  { from: "done", to: "in_progress", name: "Reopen" },
];
