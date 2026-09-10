import { describe, expect, it } from "vitest";
import {
  MAX_OFFSET_DAYS,
  SOP_CREATES_META,
  SOP_GATE_META,
  SOP_STEP_CREATES,
  SOP_STEP_GATES,
  formatOffset,
  shortOffset,
  sopAssigneeRuleSchema,
  sopStepSchema,
  sopTemplateSchema,
} from "./template";

describe("offset formatting", () => {
  it("names the anchor day rather than showing zero", () => {
    expect(formatOffset(0)).toBe("Anchor day");
    expect(shortOffset(0)).toBe("D0");
  });

  it("reads negative offsets as before the anchor", () => {
    expect(formatOffset(-14)).toBe("14d before");
    expect(shortOffset(-14)).toBe("D-14");
  });

  it("reads positive offsets as after the anchor", () => {
    expect(formatOffset(3)).toBe("3d after");
    expect(shortOffset(3)).toBe("D+3");
  });
});

describe("registry completeness", () => {
  /**
   * A gate or "creates" value that reaches the DB with no entry here would
   * render as blank in the builder. Walking the enum catches a new value
   * added to the schema without its meaning.
   */
  it("describes every gate in the enum", () => {
    for (const gate of SOP_STEP_GATES) {
      expect(SOP_GATE_META[gate]?.label).toBeTruthy();
      expect(SOP_GATE_META[gate]?.hint).toBeTruthy();
    }
  });

  it("describes every creates value in the enum", () => {
    for (const creates of SOP_STEP_CREATES) {
      expect(SOP_CREATES_META[creates]?.label).toBeTruthy();
      expect(SOP_CREATES_META[creates]?.hint).toBeTruthy();
    }
  });
});

describe("sopTemplateSchema", () => {
  const valid = { name: "Campaign launch", anchorLabel: "Launch date" };

  it("accepts a minimal template", () => {
    expect(sopTemplateSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses a blank name", () => {
    const result = sopTemplateSchema.safeParse({ ...valid, name: "   " });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/name/i);
    }
  });

  it("refuses a blank anchor label — a run needs a date to count from", () => {
    expect(
      sopTemplateSchema.safeParse({ ...valid, anchorLabel: "" }).success,
    ).toBe(false);
  });

  it("trims surrounding whitespace", () => {
    const result = sopTemplateSchema.safeParse({
      ...valid,
      name: "  Monthly cycle  ",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("Monthly cycle");
  });
});

describe("sopStepSchema", () => {
  const valid = {
    title: "Brief approved",
    dueOffsetDays: -14,
    gate: "approval" as const,
    creates: "none" as const,
    dependsOn: [],
  };

  it("accepts a well-formed step", () => {
    expect(sopStepSchema.safeParse(valid).success).toBe(true);
  });

  it("coerces a form's string offset to a number", () => {
    const result = sopStepSchema.safeParse({ ...valid, dueOffsetDays: "-7" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.dueOffsetDays).toBe(-7);
  });

  it("refuses a fractional offset", () => {
    expect(
      sopStepSchema.safeParse({ ...valid, dueOffsetDays: 1.5 }).success,
    ).toBe(false);
  });

  /** The typo guard: 2000 where 20 was meant must not schedule a step in
   *  the next century. */
  it("refuses an offset beyond a year either side", () => {
    expect(
      sopStepSchema.safeParse({ ...valid, dueOffsetDays: MAX_OFFSET_DAYS + 1 })
        .success,
    ).toBe(false);
    expect(
      sopStepSchema.safeParse({
        ...valid,
        dueOffsetDays: -MAX_OFFSET_DAYS - 1,
      }).success,
    ).toBe(false);
  });

  it("accepts exactly the boundary offsets", () => {
    expect(
      sopStepSchema.safeParse({ ...valid, dueOffsetDays: MAX_OFFSET_DAYS })
        .success,
    ).toBe(true);
    expect(
      sopStepSchema.safeParse({ ...valid, dueOffsetDays: -MAX_OFFSET_DAYS })
        .success,
    ).toBe(true);
  });

  it("refuses a gate outside the enum", () => {
    expect(sopStepSchema.safeParse({ ...valid, gate: "vibes" }).success).toBe(
      false,
    );
  });

  it("defaults dependsOn to empty rather than undefined", () => {
    const withoutDeps = {
      title: valid.title,
      dueOffsetDays: valid.dueOffsetDays,
      gate: valid.gate,
      creates: valid.creates,
    };
    const result = sopStepSchema.safeParse(withoutDeps);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.dependsOn).toEqual([]);
  });
});

describe("sopAssigneeRuleSchema", () => {
  it("accepts each rule kind", () => {
    expect(sopAssigneeRuleSchema.safeParse({ kind: "unassigned" }).success).toBe(
      true,
    );
    expect(
      sopAssigneeRuleSchema.safeParse({ kind: "role", value: "admin" }).success,
    ).toBe(true);
    expect(
      sopAssigneeRuleSchema.safeParse({ kind: "user", value: "user_1" }).success,
    ).toBe(true);
  });

  it("refuses a role outside the membership enum", () => {
    expect(
      sopAssigneeRuleSchema.safeParse({ kind: "role", value: "client" }).success,
    ).toBe(false);
  });

  it("refuses a user rule with no id — that would silently unassign", () => {
    expect(
      sopAssigneeRuleSchema.safeParse({ kind: "user", value: "" }).success,
    ).toBe(false);
  });

  it("refuses an unknown rule kind", () => {
    expect(sopAssigneeRuleSchema.safeParse({ kind: "team" }).success).toBe(
      false,
    );
  });
});
