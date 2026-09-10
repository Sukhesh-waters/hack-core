import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  clients,
  content,
  schedule,
  sopRuns,
  sopRunSteps,
  users,
} from "@/db/schema";

export type SprintDeckPost = {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  type: string;
  body: string | null;
  status: string;
  pillar: string | null;
  strategyNote: string | null;
  complianceStatus: "pending" | "passed" | "flagged";
  complianceReport: Array<{ rule: string; excerpt: string; why: string }> | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: Date | null;
  scheduledFor: Date | null;
};

export type SprintDeckStep = {
  id: string;
  runId: string;
  position: number;
  title: string;
  description: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: Date;
  status: "blocked" | "ready" | "in_progress" | "done" | "skipped";
  gate: "none" | "approval" | "compliance";
  creates: "none" | "content" | "ticket" | "doc" | "task";
  linkedType: string | null;
  linkedId: string | null;
  dependsOn: string[];
};

export type SprintDeckData = {
  run: {
    id: string;
    name: string;
    status: string;
    clientId: string | null;
    clientName: string | null;
    anchorDate: Date;
    createdAt: Date;
  };
  steps: SprintDeckStep[];
  posts: SprintDeckPost[];
  metrics: {
    totalPosts: number;
    approvedPosts: number;
    passedCompliance: number;
    flaggedCompliance: number;
    completedSteps: number;
    totalSteps: number;
    progressPercentage: number;
  };
};

/**
 * Loads the complete unified context for a Campaign Sprint Command Deck.
 */
export async function getSprintDeckQuery(
  workspaceId: string,
  runId: string,
): Promise<SprintDeckData | null> {
  // 1. Get SOP Run & Client
  const [runRow] = await db
    .select({
      id: sopRuns.id,
      name: sopRuns.name,
      status: sopRuns.status,
      clientId: sopRuns.clientId,
      clientName: clients.name,
      anchorDate: sopRuns.anchorDate,
      createdAt: sopRuns.createdAt,
    })
    .from(sopRuns)
    .leftJoin(clients, eq(clients.id, sopRuns.clientId))
    .where(and(eq(sopRuns.workspaceId, workspaceId), eq(sopRuns.id, runId)))
    .limit(1);

  if (!runRow) return null;

  // 2. Get Steps
  const rawSteps = await db
    .select({
      id: sopRunSteps.id,
      runId: sopRunSteps.runId,
      position: sopRunSteps.position,
      title: sopRunSteps.title,
      description: sopRunSteps.description,
      assigneeId: sopRunSteps.assigneeId,
      assigneeName: users.name,
      dueAt: sopRunSteps.dueAt,
      status: sopRunSteps.status,
      gate: sopRunSteps.gate,
      creates: sopRunSteps.creates,
      linkedType: sopRunSteps.linkedType,
      linkedId: sopRunSteps.linkedId,
      dependsOn: sopRunSteps.dependsOn,
    })
    .from(sopRunSteps)
    .leftJoin(users, eq(users.id, sopRunSteps.assigneeId))
    .where(and(eq(sopRunSteps.workspaceId, workspaceId), eq(sopRunSteps.runId, runId)))
    .orderBy(sopRunSteps.position);

  const steps: SprintDeckStep[] = rawSteps.map((s) => ({
    ...s,
    dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
  }));

  // 3. Get all Content linked to the steps or associated with the sprint client
  const linkedContentIds = steps
    .filter((s) => s.linkedType === "content" && s.linkedId)
    .map((s) => s.linkedId as string);

  let posts: SprintDeckPost[] = [];

  if (linkedContentIds.length > 0) {
    const postRows = await db
      .select({
        id: content.id,
        clientId: content.clientId,
        clientName: clients.name,
        title: content.title,
        type: content.type,
        body: content.body,
        status: content.status,
        pillar: content.pillar,
        strategyNote: content.strategyNote,
        complianceStatus: content.complianceStatus,
        complianceReport: content.complianceReport,
        assigneeId: content.assigneeId,
        assigneeName: users.name,
        dueAt: content.dueAt,
        scheduledFor: schedule.scheduledFor,
      })
      .from(content)
      .leftJoin(clients, eq(clients.id, content.clientId))
      .leftJoin(users, eq(users.id, content.assigneeId))
      .leftJoin(schedule, eq(schedule.contentId, content.id))
      .where(
        and(
          eq(content.workspaceId, workspaceId),
          inArray(content.id, linkedContentIds),
        ),
      );

    posts = postRows as SprintDeckPost[];
  } else if (runRow.clientId) {
    // Fallback if steps were created before linkedType was set
    const postRows = await db
      .select({
        id: content.id,
        clientId: content.clientId,
        clientName: clients.name,
        title: content.title,
        type: content.type,
        body: content.body,
        status: content.status,
        pillar: content.pillar,
        strategyNote: content.strategyNote,
        complianceStatus: content.complianceStatus,
        complianceReport: content.complianceReport,
        assigneeId: content.assigneeId,
        assigneeName: users.name,
        dueAt: content.dueAt,
        scheduledFor: schedule.scheduledFor,
      })
      .from(content)
      .leftJoin(clients, eq(clients.id, content.clientId))
      .leftJoin(users, eq(users.id, content.assigneeId))
      .leftJoin(schedule, eq(schedule.contentId, content.id))
      .where(
        and(
          eq(content.workspaceId, workspaceId),
          eq(content.clientId, runRow.clientId),
        ),
      )
      .orderBy(desc(content.createdAt))
      .limit(8);

    posts = postRows as SprintDeckPost[];
  }

  // 4. Aggregate Metrics
  const totalPosts = posts.length;
  const approvedPosts = posts.filter((p) => p.status === "approved" || p.status === "scheduled" || p.status === "published").length;
  const passedCompliance = posts.filter((p) => p.complianceStatus === "passed").length;
  const flaggedCompliance = posts.filter((p) => p.complianceStatus === "flagged").length;
  const totalSteps = steps.length;
  const completedSteps = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const progressPercentage = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return {
    run: {
      id: runRow.id,
      name: runRow.name,
      status: runRow.status,
      clientId: runRow.clientId,
      clientName: runRow.clientName,
      anchorDate: runRow.anchorDate,
      createdAt: runRow.createdAt,
    },
    steps,
    posts,
    metrics: {
      totalPosts,
      approvedPosts,
      passedCompliance,
      flaggedCompliance,
      completedSteps,
      totalSteps,
      progressPercentage,
    },
  };
}

/**
 * Lists all active and recent campaign sprints for a workspace.
 */
export async function listSprintsQuery(workspaceId: string) {
  return db
    .select({
      id: sopRuns.id,
      name: sopRuns.name,
      status: sopRuns.status,
      clientId: sopRuns.clientId,
      clientName: clients.name,
      anchorDate: sopRuns.anchorDate,
      createdAt: sopRuns.createdAt,
    })
    .from(sopRuns)
    .leftJoin(clients, eq(clients.id, sopRuns.clientId))
    .where(eq(sopRuns.workspaceId, workspaceId))
    .orderBy(desc(sopRuns.createdAt))
    .limit(20);
}
