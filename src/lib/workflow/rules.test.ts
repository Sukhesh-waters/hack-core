import { describe, expect, it } from "vitest";
import {
  evaluateConditions,
  evaluateValidators,
  hasActiveRules,
  isConditionKind,
  isPostActionKind,
  isValidatorKind,
  validateRuleConfig,
  type RuleContext,
} from "./rules";

const ctx = (over: Partial<RuleContext> = {}): RuleContext => ({
  actorId: "u_actor",
  actorRole: "member",
  content: { assigneeId: "u_actor", body: "draft text", complianceStatus: "pending" },
  ...over,
});

describe("kind guards", () => {
  it("recognise their own kind and reject the others' kinds", () => {
    expect(isConditionKind("requires_capability")).toBe(true);
    expect(isConditionKind("body_required")).toBe(false);
    expect(isValidatorKind("body_required")).toBe(true);
    expect(isValidatorKind("notify_assignee")).toBe(false);
    expect(isPostActionKind("notify_assignee")).toBe(true);
    expect(isPostActionKind("requires_capability")).toBe(false);
  });

  it("reject an unknown kind on every guard", () => {
    expect(isConditionKind("made_up")).toBe(false);
    expect(isValidatorKind("made_up")).toBe(false);
    expect(isPostActionKind("made_up")).toBe(false);
  });
});

describe("validateRuleConfig", () => {
  it("accepts a well-formed config per kind", () => {
    expect(validateRuleConfig("requires_capability", { capability: "workflow.edit" }).ok).toBe(true);
    expect(validateRuleConfig("assignee_only", {}).ok).toBe(true);
    expect(validateRuleConfig("body_required", {}).ok).toBe(true);
    expect(validateRuleConfig("compliance_passed", {}).ok).toBe(true);
    expect(validateRuleConfig("notify_assignee", {}).ok).toBe(true);
    expect(validateRuleConfig("notify_assignee", { message: "hi" }).ok).toBe(true);
    expect(validateRuleConfig("set_due_offset", { days: 3 }).ok).toBe(true);
  });

  it("rejects an unknown kind", () => {
    const result = validateRuleConfig("made_up", {});
    expect(result.ok).toBe(false);
  });

  it("rejects a capability outside the known set", () => {
    const result = validateRuleConfig("requires_capability", { capability: "nope" });
    expect(result.ok).toBe(false);
  });

  it("rejects a days offset outside 0-365", () => {
    expect(validateRuleConfig("set_due_offset", { days: -1 }).ok).toBe(false);
    expect(validateRuleConfig("set_due_offset", { days: 366 }).ok).toBe(false);
    expect(validateRuleConfig("set_due_offset", { days: 1.5 }).ok).toBe(false);
  });

  it("rejects a notify_assignee message over 200 chars", () => {
    const result = validateRuleConfig("notify_assignee", { message: "x".repeat(201) });
    expect(result.ok).toBe(false);
  });
});

describe("evaluateConditions", () => {
  it("passes with no conditions", () => {
    expect(evaluateConditions([], ctx())).toEqual({ ok: true });
  });

  it("requires_capability blocks a role that lacks it", () => {
    const result = evaluateConditions(
      [{ kind: "requires_capability", config: { capability: "workflow.edit" } }],
      ctx({ actorRole: "member" }),
    );
    expect(result.ok).toBe(false);
  });

  it("requires_capability allows a role that holds it", () => {
    const result = evaluateConditions(
      [{ kind: "requires_capability", config: { capability: "workflow.edit" } }],
      ctx({ actorRole: "admin" }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("assignee_only blocks anyone but the assignee", () => {
    const result = evaluateConditions(
      [{ kind: "assignee_only", config: {} }],
      ctx({ actorId: "u_other", content: { assigneeId: "u_actor", body: "x", complianceStatus: "pending" } }),
    );
    expect(result.ok).toBe(false);
  });

  it("assignee_only allows the assignee", () => {
    const result = evaluateConditions(
      [{ kind: "assignee_only", config: {} }],
      ctx({ actorId: "u_actor", content: { assigneeId: "u_actor", body: "x", complianceStatus: "pending" } }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("skips a rule whose kind belongs to another category", () => {
    const result = evaluateConditions(
      [{ kind: "body_required", config: {} }],
      ctx({ content: { assigneeId: null, body: "", complianceStatus: "pending" } }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("skips a rule with a config that fails its own schema, rather than throwing", () => {
    expect(() =>
      evaluateConditions(
        [{ kind: "requires_capability", config: { capability: "not_real" } }],
        ctx({ actorRole: "member" }),
      ),
    ).not.toThrow();
    const result = evaluateConditions(
      [{ kind: "requires_capability", config: { capability: "not_real" } }],
      ctx({ actorRole: "member" }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("stops at the first failing condition", () => {
    const result = evaluateConditions(
      [
        { kind: "requires_capability", config: { capability: "workflow.edit" } },
        { kind: "assignee_only", config: {} },
      ],
      ctx({ actorRole: "member", actorId: "u_other" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/workflow\.edit/);
  });
});

describe("evaluateValidators", () => {
  it("passes with no validators", () => {
    expect(evaluateValidators([], ctx())).toEqual({ ok: true });
  });

  it("body_required blocks an empty or whitespace-only body", () => {
    const empty = evaluateValidators(
      [{ kind: "body_required", config: {} }],
      ctx({ content: { assigneeId: null, body: "", complianceStatus: "pending" } }),
    );
    expect(empty.ok).toBe(false);

    const whitespace = evaluateValidators(
      [{ kind: "body_required", config: {} }],
      ctx({ content: { assigneeId: null, body: "   ", complianceStatus: "pending" } }),
    );
    expect(whitespace.ok).toBe(false);

    const nullBody = evaluateValidators(
      [{ kind: "body_required", config: {} }],
      ctx({ content: { assigneeId: null, body: null, complianceStatus: "pending" } }),
    );
    expect(nullBody.ok).toBe(false);
  });

  it("body_required allows real content", () => {
    const result = evaluateValidators(
      [{ kind: "body_required", config: {} }],
      ctx({ content: { assigneeId: null, body: "real draft", complianceStatus: "pending" } }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("compliance_passed blocks until compliance has passed", () => {
    const pending = evaluateValidators(
      [{ kind: "compliance_passed", config: {} }],
      ctx({ content: { assigneeId: null, body: "x", complianceStatus: "pending" } }),
    );
    expect(pending.ok).toBe(false);

    const flagged = evaluateValidators(
      [{ kind: "compliance_passed", config: {} }],
      ctx({ content: { assigneeId: null, body: "x", complianceStatus: "flagged" } }),
    );
    expect(flagged.ok).toBe(false);

    const passed = evaluateValidators(
      [{ kind: "compliance_passed", config: {} }],
      ctx({ content: { assigneeId: null, body: "x", complianceStatus: "passed" } }),
    );
    expect(passed).toEqual({ ok: true });
  });

  it("skips a rule whose kind belongs to another category", () => {
    const result = evaluateValidators(
      [{ kind: "notify_assignee", config: {} }],
      ctx(),
    );
    expect(result).toEqual({ ok: true });
  });
});

describe("hasActiveRules", () => {
  it("is false for an empty list", () => {
    expect(hasActiveRules([])).toBe(false);
  });

  it("is true for a valid recognised rule, any category", () => {
    expect(hasActiveRules([{ kind: "assignee_only", config: {} }])).toBe(true);
    expect(hasActiveRules([{ kind: "body_required", config: {} }])).toBe(true);
    expect(hasActiveRules([{ kind: "notify_assignee", config: {} }])).toBe(true);
  });

  it("is false when every rule is unrecognised or malformed", () => {
    expect(hasActiveRules([{ kind: "made_up", config: {} }])).toBe(false);
    expect(
      hasActiveRules([{ kind: "requires_capability", config: { capability: "nope" } }]),
    ).toBe(false);
  });
});
