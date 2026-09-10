import { describe, expect, it } from "vitest";
import type { AutomationAction, AutomationTrigger } from "@/db/schema";
import {
  automationActionSchema,
  automationRuleShellSchema,
  automationRunDue,
  automationTriggerSchema,
  describeAction,
  describeTrigger,
  isSensibleRule,
  linkForTrigger,
  triggerCutoff,
} from "./automation";

describe("automationRunDue", () => {
  const now = new Date("2026-07-20T10:00:00Z");

  it("never due when disabled", () => {
    expect(
      automationRunDue(
        { enabled: false, cadence: "daily", lastRunAt: null },
        now,
      ),
    ).toBe(false);
    expect(
      automationRunDue(
        {
          enabled: false,
          cadence: "hourly",
          lastRunAt: new Date("2020-01-01T00:00:00Z"),
        },
        now,
      ),
    ).toBe(false);
  });

  it("due immediately when enabled and never run", () => {
    expect(
      automationRunDue(
        { enabled: true, cadence: "daily", lastRunAt: null },
        now,
      ),
    ).toBe(true);
    expect(
      automationRunDue(
        { enabled: true, cadence: "hourly", lastRunAt: null },
        now,
      ),
    ).toBe(true);
  });

  it("hourly: due after 1h, not before", () => {
    const rule = {
      enabled: true,
      cadence: "hourly" as const,
      lastRunAt: new Date("2026-07-20T09:00:00Z"),
    };
    expect(automationRunDue(rule, now)).toBe(true);
    expect(
      automationRunDue(
        { ...rule, lastRunAt: new Date("2026-07-20T09:01:00Z") },
        now,
      ),
    ).toBe(false);
  });

  it("daily: due after 24h, not before", () => {
    const rule = {
      enabled: true,
      cadence: "daily" as const,
      lastRunAt: new Date("2026-07-19T10:00:00Z"),
    };
    expect(automationRunDue(rule, now)).toBe(true);
    expect(
      automationRunDue(
        { ...rule, lastRunAt: new Date("2026-07-19T11:00:00Z") },
        now,
      ),
    ).toBe(false);
  });
});

describe("triggerCutoff", () => {
  const now = new Date("2026-07-20T10:00:00Z");

  it("idea_stale: converts days to a cutoff timestamp", () => {
    const cutoff = triggerCutoff({ kind: "idea_stale", days: 3 }, now);
    expect(cutoff).toEqual(new Date("2026-07-17T10:00:00Z"));
  });

  it("approval_stale: converts hours to a cutoff timestamp", () => {
    const cutoff = triggerCutoff({ kind: "approval_stale", hours: 6 }, now);
    expect(cutoff).toEqual(new Date("2026-07-20T04:00:00Z"));
  });

  it("ticket_unassigned: converts hours to a cutoff timestamp", () => {
    const cutoff = triggerCutoff(
      { kind: "ticket_unassigned", hours: 24 },
      now,
    );
    expect(cutoff).toEqual(new Date("2026-07-19T10:00:00Z"));
  });
});

describe("automationTriggerSchema", () => {
  it("accepts each valid trigger kind", () => {
    expect(
      automationTriggerSchema.safeParse({ kind: "idea_stale", days: 3 })
        .success,
    ).toBe(true);
    expect(
      automationTriggerSchema.safeParse({
        kind: "approval_stale",
        hours: 12,
      }).success,
    ).toBe(true);
    expect(
      automationTriggerSchema.safeParse({
        kind: "ticket_unassigned",
        hours: 4,
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown kind", () => {
    expect(
      automationTriggerSchema.safeParse({ kind: "content_stale", days: 3 })
        .success,
    ).toBe(false);
  });

  it("rejects out-of-range numbers (zero, negative, non-integer)", () => {
    expect(
      automationTriggerSchema.safeParse({ kind: "idea_stale", days: 0 })
        .success,
    ).toBe(false);
    expect(
      automationTriggerSchema.safeParse({ kind: "idea_stale", days: -1 })
        .success,
    ).toBe(false);
    expect(
      automationTriggerSchema.safeParse({
        kind: "approval_stale",
        hours: 0,
      }).success,
    ).toBe(false);
    expect(
      automationTriggerSchema.safeParse({
        kind: "ticket_unassigned",
        hours: -5,
      }).success,
    ).toBe(false);
    expect(
      automationTriggerSchema.safeParse({ kind: "idea_stale", days: 1.5 })
        .success,
    ).toBe(false);
  });
});

describe("automationActionSchema", () => {
  it("accepts each valid action kind", () => {
    expect(
      automationActionSchema.safeParse({
        kind: "create_ticket",
        title: "Follow up",
        priority: "high",
      }).success,
    ).toBe(true);
    expect(
      automationActionSchema.safeParse({
        kind: "hub_message",
        body: "Heads up team",
      }).success,
    ).toBe(true);
    expect(
      automationActionSchema.safeParse({
        kind: "hub_reminder",
        title: "Check in",
        hoursFromNow: 2,
        ownerId: "user_1",
      }).success,
    ).toBe(true);
    expect(
      automationActionSchema.safeParse({
        kind: "email",
        subject: "Weekly digest",
        body: "Here's what happened",
        audience: "team",
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown kind", () => {
    expect(
      automationActionSchema.safeParse({
        kind: "slack_message",
        body: "hi",
      }).success,
    ).toBe(false);
  });

  it("rejects out-of-range/empty fields", () => {
    expect(
      automationActionSchema.safeParse({
        kind: "create_ticket",
        title: "",
        priority: "high",
      }).success,
    ).toBe(false);
    expect(
      automationActionSchema.safeParse({
        kind: "create_ticket",
        title: "Follow up",
        priority: "urgent",
      }).success,
    ).toBe(false);
    expect(
      automationActionSchema.safeParse({ kind: "hub_message", body: "" })
        .success,
    ).toBe(false);
    expect(
      automationActionSchema.safeParse({
        kind: "hub_reminder",
        title: "Check in",
        hoursFromNow: -1,
        ownerId: "user_1",
      }).success,
    ).toBe(false);
    expect(
      automationActionSchema.safeParse({
        kind: "hub_reminder",
        title: "Check in",
        hoursFromNow: 2,
        ownerId: "",
      }).success,
    ).toBe(false);
    expect(
      automationActionSchema.safeParse({
        kind: "email",
        subject: "",
        body: "Body",
        audience: "team",
      }).success,
    ).toBe(false);
    expect(
      automationActionSchema.safeParse({
        kind: "email",
        subject: "Subject",
        body: "Body",
        audience: "client",
      }).success,
    ).toBe(false);
  });
});

describe("automationRuleShellSchema", () => {
  it("accepts a valid shell", () => {
    const result = automationRuleShellSchema.safeParse({
      workspaceId: "ws_1",
      name: "Ping stale ideas",
      cadence: "daily",
      enabled: true,
    });
    expect(result.success).toBe(true);
  });

  it("defaults enabled to false when omitted", () => {
    const result = automationRuleShellSchema.safeParse({
      workspaceId: "ws_1",
      name: "Ping stale ideas",
      cadence: "daily",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.enabled).toBe(false);
  });

  it("rejects an empty name or bad cadence", () => {
    expect(
      automationRuleShellSchema.safeParse({
        workspaceId: "ws_1",
        name: "",
        cadence: "daily",
      }).success,
    ).toBe(false);
    expect(
      automationRuleShellSchema.safeParse({
        workspaceId: "ws_1",
        name: "Ping",
        cadence: "weekly",
      }).success,
    ).toBe(false);
  });
});

describe("describeTrigger", () => {
  it("idea_stale", () => {
    expect(describeTrigger({ kind: "idea_stale", days: 3 })).toBe(
      "Idea sits unassigned for 3+ days",
    );
    expect(describeTrigger({ kind: "idea_stale", days: 1 })).toBe(
      "Idea sits unassigned for 1+ day",
    );
  });

  it("approval_stale", () => {
    expect(describeTrigger({ kind: "approval_stale", hours: 6 })).toBe(
      "Approval sits pending for 6+ hours",
    );
    expect(describeTrigger({ kind: "approval_stale", hours: 1 })).toBe(
      "Approval sits pending for 1+ hour",
    );
  });

  it("ticket_unassigned", () => {
    expect(describeTrigger({ kind: "ticket_unassigned", hours: 24 })).toBe(
      "High-priority ticket is unassigned for 24+ hours",
    );
  });
});

describe("describeAction", () => {
  it("create_ticket", () => {
    expect(
      describeAction({
        kind: "create_ticket",
        title: "Follow up",
        priority: "high",
      }),
    ).toBe('Create a high-priority ticket: "Follow up"');
  });

  it("hub_message", () => {
    expect(describeAction({ kind: "hub_message", body: "Heads up" })).toBe(
      "Post a message to Team Hub",
    );
  });

  it("hub_reminder", () => {
    expect(
      describeAction({
        kind: "hub_reminder",
        title: "Check in",
        hoursFromNow: 2,
        ownerId: "user_1",
      }),
    ).toBe('Set a reminder ("Check in") 2h from now');
  });

  it("email", () => {
    expect(
      describeAction({
        kind: "email",
        subject: "Weekly digest",
        body: "…",
        audience: "team",
      }),
    ).toBe('Email the team: "Weekly digest"');
  });
});

describe("isSensibleRule", () => {
  it("rejects ticket_unassigned + create_ticket — circular, a ticket about an unassigned ticket", () => {
    expect(isSensibleRule("ticket_unassigned", "create_ticket")).toBe(false);
  });

  it("idea_stale + create_ticket: true", () => {
    expect(isSensibleRule("idea_stale", "create_ticket")).toBe(true);
  });

  it("approval_stale + create_ticket: true", () => {
    expect(isSensibleRule("approval_stale", "create_ticket")).toBe(true);
  });

  it("ticket_unassigned + hub_message: true", () => {
    expect(isSensibleRule("ticket_unassigned", "hub_message")).toBe(true);
  });

  it("ticket_unassigned + hub_reminder: true", () => {
    expect(isSensibleRule("ticket_unassigned", "hub_reminder")).toBe(true);
  });

  it("ticket_unassigned + email: true", () => {
    expect(isSensibleRule("ticket_unassigned", "email")).toBe(true);
  });

  it("the reject-list is exactly the one evidenced combination — every other trigger×action pairing is sensible", () => {
    const triggerKinds: AutomationTrigger["kind"][] = [
      "idea_stale",
      "approval_stale",
      "ticket_unassigned",
    ];
    const actionKinds: AutomationAction["kind"][] = [
      "create_ticket",
      "hub_message",
      "hub_reminder",
      "email",
    ];
    const rejected = triggerKinds.flatMap((trigger) =>
      actionKinds
        .filter((action) => !isSensibleRule(trigger, action))
        .map((action) => `${trigger}+${action}`),
    );
    expect(rejected).toEqual(["ticket_unassigned+create_ticket"]);
  });
});

describe("linkForTrigger", () => {
  it("idea_stale: links to the matched idea", () => {
    expect(linkForTrigger("idea_stale", "idea_123")).toEqual({
      linkedType: "idea",
      linkedId: "idea_123",
    });
  });

  it("approval_stale: no valid enum value — links null", () => {
    expect(linkForTrigger("approval_stale", "approval_456")).toEqual({
      linkedType: null,
      linkedId: null,
    });
  });

  it("ticket_unassigned: ticket-to-ticket isn't representable — links null", () => {
    expect(linkForTrigger("ticket_unassigned", "ticket_789")).toEqual({
      linkedType: null,
      linkedId: null,
    });
  });
});
