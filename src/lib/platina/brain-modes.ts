/**
 * Per-stage Brain mode parsing (B0 — metacognitive Brain). A stage's mode is
 * "off" | "shadow" | "on"; a missing key or any invalid value reads as "off",
 * so a bad or half-written config can never silently turn a stage on.
 * See CLAUDE.md and docs/superpowers/plans/2026-10-13-metacognitive-brain.md
 * §2.1 (modes), §5 B0.
 */
import { createHash } from "node:crypto";

export const BRAIN_STAGES = [
  "interrogation",
  "challenger",
  "gate",
  "surprise",
  "retrieval",
  "budget",
  "grading",
] as const;

export type BrainStage = (typeof BRAIN_STAGES)[number];
export type BrainMode = "off" | "shadow" | "on";
export type BrainModes = Partial<Record<BrainStage, BrainMode>>;

const VALID_MODES: ReadonlySet<string> = new Set(["off", "shadow", "on"]);

/** A complete mode map, one entry per stage, with every missing/invalid value resolved to "off". */
export function parseBrainModes(raw: unknown): Record<BrainStage, BrainMode> {
  const source: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = {} as Record<BrainStage, BrainMode>;
  for (const stage of BRAIN_STAGES) {
    const value = source[stage];
    out[stage] = typeof value === "string" && VALID_MODES.has(value) ? (value as BrainMode) : "off";
  }
  return out;
}

/** The mode for one stage, from a workspace config row (or none, which is every stage "off"). */
export function modeOf(config: { brainModes?: unknown } | null | undefined, stage: BrainStage): BrainMode {
  return parseBrainModes(config?.brainModes)[stage];
}

/**
 * A stable pseudo-random split over an id: true for exactly `share` of all
 * ids, and the same answer every time it is called. Used for the blind
 * challenger's 50/50 shadow arm (B2) and the surprise filter's audit sample
 * (B4). `salt` separates independent splits computed over the same id (e.g.
 * "challenger-arm" vs "surprise-audit" should not correlate).
 */
export function deterministicShare(id: string, share: number, salt = ""): boolean {
  if (share <= 0) return false;
  if (share >= 1) return true;
  const digest = createHash("sha256").update(`${salt}:${id}`).digest();
  const bucket = digest.readUInt32BE(0) / 0x100000000; // -> [0, 1)
  return bucket < share;
}
