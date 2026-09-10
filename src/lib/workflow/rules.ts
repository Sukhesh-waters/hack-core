import { z } from "zod";
import { CAPABILITIES, roleCan, type MembershipRole } from "@/lib/permissions";
import type { WorkflowRule } from "@/db/schema";

/**
 * W5 — transition rules, as pure logic.
 *
 * Three kinds, matching Jira's conditions / validators / post-functions:
 * conditions gate who may even attempt the move, validators check the row
 * itself, post-actions run after a successful move. All three are typed
 * jsonb arrays validated through this ONE registry — the same discipline
 * lib/custom-fields.ts uses for field types, and for the same reason: a
 * rule config that isn't checked against its own kind's schema is how a
 * malformed row silently disables a gate nobody meant to remove.
 */

export const CONDITION_KINDS = ["requires_capability", "assignee_only"] as const;
export type ConditionKind = (typeof CONDITION_KINDS)[number];

export const VALIDATOR_KINDS = ["body_required", "compliance_passed"] as const;
export type ValidatorKind = (typeof VALIDATOR_KINDS)[number];

export const POST_ACTION_KINDS = ["notify_assignee", "set_due_offset"] as const;
export type PostActionKind = (typeof POST_ACTION_KINDS)[number];

export const RULE_CATEGORIES = ["condition", "validator", "postAction"] as const;
export type WorkflowRuleCategory = (typeof RULE_CATEGORIES)[number];

export type RuleMeta = { kind: string; label: string; hint: string };

export const CONDITION_META: Record<ConditionKind, RuleMeta> = {
  requires_capability: {
    kind: "requires_capability",
    label: "Requires a capability",
    hint: "Only someone whose role holds this capability may make this move.",
  },
  assignee_only: {
    kind: "assignee_only",
    label: "Assignee only",
    hint: "Only the card's assignee may make this move.",
  },
};

export const VALIDATOR_META: Record<ValidatorKind, RuleMeta> = {
  body_required: {
    kind: "body_required",
    label: "Draft must have content",
    hint: "Blocks the move while the card's body is empty.",
  },
  compliance_passed: {
    kind: "compliance_passed",
    label: "Compliance must have passed",
    hint: "Blocks the move until compliance has run and passed.",
  },
};

export const POST_ACTION_META: Record<PostActionKind, RuleMeta> = {
  notify_assignee: {
    kind: "notify_assignee",
    label: "Notify the assignee",
    hint: "Sends an in-app notification to whoever is assigned.",
  },
  set_due_offset: {
    kind: "set_due_offset",
    label: "Set a due date",
    hint: "Sets the due date to N days from when this move happens.",
  },
};

export function isConditionKind(value: string): value is ConditionKind {
  return (CONDITION_KINDS as readonly string[]).includes(value);
}
export function isValidatorKind(value: string): value is ValidatorKind {
  return (VALIDATOR_KINDS as readonly string[]).includes(value);
}
export function isPostActionKind(value: string): value is PostActionKind {
  return (POST_ACTION_KINDS as readonly string[]).includes(value);
}

/** Per-kind config schema. A rule that fails its own kind's schema is
 *  treated as if it doesn't exist — see evaluateConditions/Validators —
 *  rather than throwing, because a bad row must not brick every transition
 *  that happens to carry it. */
const CONFIG_SCHEMAS: Record<string, z.ZodTypeAny> = {
  requires_capability: z.object({ capability: z.enum(CAPABILITIES) }),
  assignee_only: z.object({}),
  body_required: z.object({}),
  compliance_passed: z.object({}),
  notify_assignee: z.object({ message: z.string().max(200).optional() }),
  set_due_offset: z.object({ days: z.number().int().min(0).max(365) }),
};

export function validateRuleConfig(
  kind: string,
  config: unknown,
): { ok: true; config: Record<string, unknown> } | { ok: false; error: string } {
  const schema = CONFIG_SCHEMAS[kind];
  if (!schema) return { ok: false, error: `Unknown rule kind "${kind}".` };
  const parsed = schema.safeParse(config);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid rule." };
  }
  return { ok: true, config: parsed.data as Record<string, unknown> };
}

export type RuleContext = {
  actorId: string;
  actorRole: MembershipRole;
  content: {
    assigneeId: string | null;
    body: string | null;
    complianceStatus: "pending" | "passed" | "flagged";
  };
};

export type RuleCheckResult = { ok: true } | { ok: false; reason: string };

/**
 * A rule whose kind or config this registry doesn't recognise is SKIPPED,
 * not refused. Refusing on an unrecognised rule would let a schema drift
 * (an old kind renamed, a future kind not yet deployed here) silently lock
 * every card behind a gate nobody can see or explain. Skipping is the same
 * choice custom-fields.ts makes for an orphaned field id.
 */
export function evaluateConditions(
  conditions: WorkflowRule[],
  ctx: RuleContext,
): RuleCheckResult {
  for (const rule of conditions) {
    if (!isConditionKind(rule.kind)) continue;
    const checked = validateRuleConfig(rule.kind, rule.config);
    if (!checked.ok) continue;

    if (rule.kind === "requires_capability") {
      const capability = checked.config.capability as Parameters<
        typeof roleCan
      >[1];
      if (!roleCan(ctx.actorRole, capability)) {
        return {
          ok: false,
          reason: `Only someone who can "${capability}" may make this move.`,
        };
      }
    }

    if (rule.kind === "assignee_only") {
      if (ctx.content.assigneeId !== ctx.actorId) {
        return { ok: false, reason: "Only the assignee may make this move." };
      }
    }
  }
  return { ok: true };
}

export function evaluateValidators(
  validators: WorkflowRule[],
  ctx: RuleContext,
): RuleCheckResult {
  for (const rule of validators) {
    if (!isValidatorKind(rule.kind)) continue;
    const checked = validateRuleConfig(rule.kind, rule.config);
    if (!checked.ok) continue;

    if (rule.kind === "body_required" && !ctx.content.body?.trim()) {
      return { ok: false, reason: "This draft has no content yet." };
    }

    if (
      rule.kind === "compliance_passed" &&
      ctx.content.complianceStatus !== "passed"
    ) {
      return { ok: false, reason: "Compliance hasn't passed yet." };
    }
  }
  return { ok: true };
}

/** Whether a rule set contains at least one entry the evaluator would
 *  actually act on — for the admin UI to show "this move is gated". */
export function hasActiveRules(rules: WorkflowRule[]): boolean {
  return rules.some(
    (r) =>
      (isConditionKind(r.kind) ||
        isValidatorKind(r.kind) ||
        isPostActionKind(r.kind)) &&
      validateRuleConfig(r.kind, r.config).ok,
  );
}
