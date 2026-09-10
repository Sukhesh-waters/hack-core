import { describe, expect, it } from "vitest";
import {
  isValidTransition,
  PRODUCTION_STAGE_LABELS,
  PRODUCTION_STAGE_ORDER,
  transitionsFor,
  type ProductionStage,
} from "@/lib/production";
import {
  DEFAULT_CONTENT_STATES,
  DEFAULT_CONTENT_TRANSITIONS,
  isWorkflowColorKey,
  workflowColor,
  WORKFLOW_STATE_COLORS,
} from "./defaults";

/**
 * The acceptance test for the whole strangler-fig migration.
 *
 * A workspace that never customises its workflow must see a pixel-identical
 * product after W1. That only holds if the seeded rows reproduce
 * lib/production.ts exactly — so these assertions compare the seed against
 * the hardcoded graph itself, not against a second copy of the expected
 * values. If someone edits either side, this fails.
 */
describe("seed fidelity — default workflow mirrors lib/production.ts", () => {
  it("has one state per production_stage, in the same order", () => {
    expect(DEFAULT_CONTENT_STATES.map((s) => s.key)).toEqual([
      ...PRODUCTION_STAGE_ORDER,
    ]);
  });

  it("maps every state to its legacy enum value", () => {
    for (const state of DEFAULT_CONTENT_STATES) {
      expect(state.legacyStage).toBe(state.key);
    }
  });

  it("reuses the existing labels rather than inventing new ones", () => {
    for (const state of DEFAULT_CONTENT_STATES) {
      expect(state.name).toBe(
        PRODUCTION_STAGE_LABELS[state.key as ProductionStage],
      );
    }
  });

  /**
   * Every seeded transition must be one the old graph allowed, and every
   * transition the old graph allowed must be seeded. Both directions —
   * a missing edge strands work, an extra edge invents a shortcut past a
   * gate nobody approved.
   */
  it("seeds exactly the transitions the hardcoded graph allows", () => {
    const seeded = DEFAULT_CONTENT_TRANSITIONS.filter((t) => t.from !== null);

    for (const transition of seeded) {
      expect(
        isValidTransition(
          transition.from as ProductionStage,
          transition.to as ProductionStage,
        ),
        `seeded ${transition.from} → ${transition.to} is not in the graph`,
      ).toBe(true);
    }

    for (const from of PRODUCTION_STAGE_ORDER) {
      for (const legacy of transitionsFor(from)) {
        const match = seeded.find(
          (t) => t.from === from && t.to === legacy.to,
        );
        expect(
          match,
          `graph allows ${from} → ${legacy.to} but it is not seeded`,
        ).toBeDefined();
      }
    }
  });

  it("carries the semantic verb from the graph, not the destination name", () => {
    for (const from of PRODUCTION_STAGE_ORDER) {
      for (const legacy of transitionsFor(from)) {
        const seeded = DEFAULT_CONTENT_TRANSITIONS.find(
          (t) => t.from === from && t.to === legacy.to,
        );
        expect(seeded?.name).toBe(legacy.label);
      }
    }
  });

  it("defines exactly one initial transition, landing on the first stage", () => {
    const initial = DEFAULT_CONTENT_TRANSITIONS.filter((t) => t.from === null);
    expect(initial).toHaveLength(1);
    expect(initial[0].to).toBe(PRODUCTION_STAGE_ORDER[0]);
  });

  /**
   * Category "done" means the completed LANE, not a terminal sink — done
   * work must stay reopenable (audit: "done page elements cannot be brought
   * back"). The categories are asserted explicitly so a state can gain or
   * lose exits without silently changing which lane it renders in.
   */
  it("assigns lanes explicitly — done is a lane, not a dead end", () => {
    expect(
      Object.fromEntries(
        DEFAULT_CONTENT_STATES.map((s) => [s.key, s.category]),
      ),
    ).toEqual({
      brief: "todo",
      in_progress: "doing",
      internal_review: "doing",
      revision: "doing",
      done: "done",
    });
  });

  it("seeds the reopen edge so done work can come back", () => {
    const reopen = DEFAULT_CONTENT_TRANSITIONS.find(
      (t) => t.from === "done",
    );
    expect(reopen).toEqual({
      from: "done",
      to: "in_progress",
      name: "Reopen",
    });
  });
});

describe("workflowColor", () => {
  it("resolves every seeded colour key", () => {
    for (const state of DEFAULT_CONTENT_STATES) {
      expect(isWorkflowColorKey(state.colorKey)).toBe(true);
    }
  });

  /**
   * A stored colour is a key into a fixed palette, never an interpolated
   * class — Tailwind's JIT scans source text, so a template-built class name
   * silently ships as nothing. An unknown key must fall back to a real class
   * rather than render `undefined`.
   */
  it("falls back to a real class for an unknown key", () => {
    expect(workflowColor("chartreuse")).toBe(WORKFLOW_STATE_COLORS.slate);
    expect(workflowColor("")).toBe(WORKFLOW_STATE_COLORS.slate);
  });

  it("every palette entry is a fully-written static class string", () => {
    for (const [key, value] of Object.entries(WORKFLOW_STATE_COLORS)) {
      expect(value.chip, `${key}.chip`).not.toContain("${");
      expect(value.dot, `${key}.dot`).not.toContain("${");
      expect(value.chip).toMatch(/^bg-[a-z]+-\d+\/\d+ text-[a-z]+-\d+$/);
    }
  });
});
