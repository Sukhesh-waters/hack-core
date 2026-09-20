"use server";

import { requireUser } from "@/auth";
import { listClients } from "@/db/queries/clients";
import { hubApprovalsQuery, hubTasksQuery } from "@/db/queries/hub";
import { newIdeasQuery } from "@/db/queries/ideas";
import { getMembership } from "@/db/queries/memberships";
import { scheduledSlotsQuery } from "@/db/queries/schedule";
import { getWorkspaceById } from "@/db/queries/workspaces";
import { actionErrorMessage } from "@/lib/action-errors";
import { askPlatina, type AskGrounding } from "@/lib/ai/agents/content";
import { runWithAiCost } from "@/lib/ai/usage-context";
import { askSchema } from "@/lib/validation";

export type AskResult = { answer: string } | { error: string };

/** Ask Platina — grounded on this workspace's first-party/operational
 *  rows only (never pattern-layer data). Role rides into the system prompt. */
export async function askPlatinaAction(input: {
  workspaceId: string;
  question: string;
}): Promise<AskResult> {
  const parsed = askSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, question } = parsed.data;

  try {
    const user = await requireUser();
    const membership = await getMembership(workspaceId, user.id);
    if (!membership) return { error: "Not a member of this workspace." };

    const [workspace, clients, slots, tasks, approvals, ideas] =
      await Promise.all([
        getWorkspaceById(workspaceId),
        listClients(workspaceId),
        scheduledSlotsQuery(workspaceId),
        hubTasksQuery(workspaceId),
        hubApprovalsQuery(workspaceId),
        newIdeasQuery(workspaceId),
      ]);
    if (!workspace) return { error: "Workspace not found." };

    const now = new Date();
    const grounding: AskGrounding = {
      workspaceName: workspace.name,
      role: membership.role,
      clients: clients.map((c) => ({ name: c.name, status: c.status })),
      upcomingSlots: slots
        .filter((s) => s.scheduledFor >= now)
        .map((s) => ({
          title: s.title,
          clientName: s.clientName,
          status: s.status,
          scheduledFor: s.scheduledFor,
        })),
      openTasks: tasks
        .filter((t) => !t.done)
        .map((t) => ({ text: t.title, priority: t.priority })),
      pendingApprovals: approvals
        .filter((a) => a.status === "pending")
        .map((a) => ({ title: a.title })),
      newIdeas: ideas.map((i) => ({ topic: i.topic, hook: i.hook })),
    };

    const answer = await runWithAiCost(
      { workspaceId, purpose: "ask-platina" },
      () => askPlatina(grounding, question),
    );
    return { answer };
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}
