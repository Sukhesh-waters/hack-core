import { getHubState, ideasQuickViewQuery } from "@/db/queries/hub";
import { getWorkspaceById } from "@/db/queries/workspaces";
import { formatDue, formatHubTime } from "@/lib/data/format";
import { hubReminderStatus } from "@/lib/reminders";
import type { HubMessage, HubPriority, TeamHubData } from "@/lib/data/types";

type HubRows = Awaited<ReturnType<typeof getHubState>>;
type IdeaRows = Awaited<ReturnType<typeof ideasQuickViewQuery>>;

const PRIORITY_UP: Record<"high" | "medium" | "low", HubPriority> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

function displayName(name: string | null, email: string | null) {
  return name ?? email ?? "Member";
}

function initialOf(label: string) {
  return (label[0] ?? "?").toUpperCase();
}

export function mapTeamHub(
  input: {
    workspaceName: string;
    members: HubRows["members"];
    messages: HubRows["messages"];
    approvals: HubRows["approvals"];
    tasks: HubRows["tasks"];
    completedTasks?: HubRows["completedTasks"];
    reminders: HubRows["reminders"];
    ideas: IdeaRows;
  },
  now: Date = new Date(),
): TeamHubData {
  const approvalById = new Map(input.approvals.map((a) => [a.id, a]));
  const memberById = new Map(input.members.map((m) => [m.id, m]));

  const messages: HubMessage[] = input.messages.flatMap((m): HubMessage[] => {
    const time = formatHubTime(m.createdAt, now);
    if (m.kind === "system") {
      return [{ id: m.id, kind: "system" as const, time, text: m.body ?? "" }];
    }
    const author = displayName(m.authorName, m.authorEmail);
    if (m.kind === "text") {
      return [
        {
          id: m.id,
          kind: "text" as const,
          time,
          author,
          initial: initialOf(author),
          text: m.body ?? "",
        },
      ];
    }
    const approval = m.approvalId ? approvalById.get(m.approvalId) : undefined;
    if (!approval) return []; // orphaned card — skip rather than crash
    const decider = approval.decidedById
      ? memberById.get(approval.decidedById)
      : undefined;
    return [
      {
        id: m.id,
        kind: "approval" as const,
        approvalId: approval.id,
        time,
        author,
        initial: initialOf(author),
        title: approval.title,
        status: approval.status,
        decidedBy: decider
          ? displayName(decider.name, decider.email)
          : undefined,
      },
    ];
  });

  return {
    channel: `# ${input.workspaceName.toLowerCase().replace(/\s+/g, "-")}`,
    members: input.members.map((m) => {
      const label = displayName(m.name, m.email);
      return {
        id: m.id,
        name: label,
        initial: initialOf(label),
        online: false,
      };
    }),
    messages,
    approvals: input.approvals.map((a) => {
      const decider = a.decidedById ? memberById.get(a.decidedById) : undefined;
      return {
        id: a.id,
        title: a.title,
        requestedBy: displayName(a.requestedByName, a.requestedByEmail),
        time: formatHubTime(a.createdAt, now),
        status: a.status,
        decidedBy: decider
          ? displayName(decider.name, decider.email)
          : undefined,
      };
    }),
    tasks: input.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      done: t.done,
      priority: PRIORITY_UP[t.priority],
      originRunStepId: t.originRunStepId ?? null,
      sopOrigin:
        t.originRunStepId && t.sopRunId && t.sopStepTitle
          ? {
              runId: t.sopRunId,
              stepId: t.originRunStepId,
              stepTitle: t.sopStepTitle,
            }
          : null,
    })),
    completedTasks: (input.completedTasks ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      done: t.done,
      priority: PRIORITY_UP[t.priority],
      originRunStepId: t.originRunStepId ?? null,
      sopOrigin:
        t.originRunStepId && t.sopRunId && t.sopStepTitle
          ? {
              runId: t.sopRunId,
              stepId: t.originRunStepId,
              stepTitle: t.sopStepTitle,
            }
          : null,
    })),
    reminders: input.reminders.map((r) => {
      const status = hubReminderStatus(r.dueAt, r.notifiedAt, now);
      return {
        id: r.id,
        title: r.title,
        due: formatDue(r.dueAt, now),
        owner: displayName(r.ownerName, r.ownerEmail),
        overdue: status.overdue,
        sentLabel: r.notifiedAt ? `sent ${formatHubTime(r.notifiedAt, now)}` : null,
      };
    }),
    planQuickView: input.ideas
      .filter((i) => i.status !== "archived")
      .map((i) => ({
        id: i.id,
        title: i.topic,
        // Don't imply a specific format when none was set — a reviewer
        // accepting from this rail shouldn't see a fabricated "Post".
        format: i.format ?? "Format not set",
        status:
          i.status === "new" ? ("proposed" as const) : ("accepted" as const),
      })),
  };
}

export async function liveTeamHub(workspaceId: string): Promise<TeamHubData> {
  const [ws, state, ideas] = await Promise.all([
    getWorkspaceById(workspaceId),
    getHubState(workspaceId),
    ideasQuickViewQuery(workspaceId),
  ]);
  return mapTeamHub({
    workspaceName: ws?.name ?? "workspace",
    ...state,
    ideas,
  });
}
