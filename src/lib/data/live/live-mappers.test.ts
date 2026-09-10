import { describe, expect, it } from "vitest";
import { mapTeamHub } from "./team-hub";
import { mapOverview } from "./overview";

const NOW = new Date("2026-07-08T12:00:00");

describe("mapTeamHub", () => {
  it("maps rows into TeamHubData with resolved names and priorities", () => {
    const data = mapTeamHub(
      {
        workspaceName: "Aurora Skincare",
        members: [{ id: "u1", name: "Priya Shah", email: "p@x.com" }],
        messages: [
          {
            id: "m1",
            kind: "text" as const,
            body: "hello",
            approvalId: null,
            createdAt: new Date("2026-07-08T09:12:00"),
            authorId: "u1",
            authorName: "Priya Shah",
            authorEmail: "p@x.com",
          },
          {
            id: "m2",
            kind: "approval" as const,
            body: null,
            approvalId: "ap1",
            createdAt: new Date("2026-07-08T09:16:00"),
            authorId: "u1",
            authorName: "Priya Shah",
            authorEmail: "p@x.com",
          },
        ],
        approvals: [
          {
            id: "ap1",
            title: "Reel v2",
            status: "pending" as const,
            createdAt: new Date("2026-07-08T09:16:00"),
            requestedByName: "Priya Shah",
            requestedByEmail: "p@x.com",
            decidedById: null,
          },
        ],
        tasks: [
          {
            id: "t1",
            workspaceId: "ws1",
            title: "Approve reel",
            done: false,
            priority: "high" as const,
            createdById: "u1",
            assigneeId: null,
            dueAt: null,
            completedAt: null,
            archivedAt: null,
            originRunStepId: null,
            sopStepTitle: null,
            sopRunId: null,
            createdAt: NOW,
          },
        ],
        reminders: [
          {
            id: "r1",
            title: "Report due",
            dueAt: new Date("2026-07-08T17:00:00"),
            notifiedAt: null,
            ownerName: "Priya Shah",
            ownerEmail: "p@x.com",
          },
        ],
        ideas: [
          {
            id: "i1",
            topic: "Myth-busting",
            format: "carousel",
            status: "new" as const,
          },
        ],
      },
      NOW,
    );

    expect(data.channel).toBe("# aurora-skincare");
    expect(data.members[0]).toEqual({
      id: "u1",
      name: "Priya Shah",
      initial: "P",
      online: false,
    });
    expect(data.messages[0]).toMatchObject({
      kind: "text",
      author: "Priya Shah",
      time: "09:12",
      text: "hello",
    });
    expect(data.messages[1]).toMatchObject({
      kind: "approval",
      approvalId: "ap1",
      title: "Reel v2",
      status: "pending",
    });
    expect(data.tasks[0].priority).toBe("High");
    expect(data.reminders[0].due).toBe("Today 17:00");
    expect(data.reminders[0].overdue).toBe(false);
    expect(data.reminders[0].sentLabel).toBeNull();
    expect(data.planQuickView[0]).toEqual({
      id: "i1",
      title: "Myth-busting",
      format: "carousel",
      status: "proposed",
    });
  });
});

describe("mapOverview", () => {
  const marketingOsFixture = {
    spend: { todayUsd: 1.5, capUsd: 5, percentUsed: 30, overCap: false },
    drift: {
      worstNarrative: "drifting" as const,
      worstClientName: "Acme",
      scoredCount: 2,
      insufficientCount: 1,
    },
    tickets: { openCount: 3, overdueCount: 1 },
    automations: {
      failureCount: 1,
      mostRecent: {
        id: "run1",
        ruleName: "Stale idea nudge",
        error: "timeout",
        occurredAt: new Date("2026-07-20T10:00:00"),
      },
    },
  };

  it("builds stats and boards from real counts", () => {
    const data = mapOverview({
      slotsThisMonth: 4,
      pendingApprovals: 2,
      overdueSlots: 1,
      newIdeas: 5,
      board: [{ id: "c1", title: "Reel v2", status: "review" as const }],
      upcoming: [
        {
          id: "s1",
          title: "Founder post",
          type: "post",
          scheduledFor: new Date("2026-07-09T10:00:00"),
          status: "scheduled" as const,
        },
      ],
      ...marketingOsFixture,
    });
    expect(data.stats.map((s) => s.value)).toEqual(["4", "2", "1", "5"]);
    expect(data.productionBoard[0].stage).toBe("Internal review");
    expect(data.upcoming[0]).toMatchObject({ day: 9, platform: "Post" });
  });

  it("passes the V3 Marketing OS signals through unchanged", () => {
    const data = mapOverview({
      slotsThisMonth: 0,
      pendingApprovals: 0,
      overdueSlots: 0,
      newIdeas: 0,
      board: [],
      upcoming: [],
      ...marketingOsFixture,
    });
    expect(data.spend).toEqual(marketingOsFixture.spend);
    expect(data.drift).toEqual(marketingOsFixture.drift);
    expect(data.tickets).toEqual(marketingOsFixture.tickets);
    expect(data.automations).toEqual(marketingOsFixture.automations);
  });
});
