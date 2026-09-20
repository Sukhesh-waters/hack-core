import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  clients,
  content,
  ideas,
  schedule,
  sopRuns,
  sopRunSteps,
  type BrandIdentity,
  type ContentTypeValue,
} from "@/db/schema";
import { getBrandProfile } from "@/db/queries/brand";
import { ensureContentWorkflow, initialStateQuery } from "@/db/queries/workflow-seed";
import { generateIdeas } from "@/lib/ai/agents/strategy";
import { generateDraft, formatDraftBody } from "@/lib/ai/agents/content";
import { checkCompliance } from "@/lib/ai/agents/critic";
import { emitDomainEvent } from "@/lib/events/dispatch";
import { addBusinessDays } from "@/lib/sop/cascade";
import {
  loadSopTemplate,
  listSopTemplates,
  type LoadedSopTemplate,
} from "@/db/queries/sop";
import { listWorkspaceMembers } from "@/db/queries/memberships";
import { instantiateRun, type InstantiatedStep } from "@/lib/sop/instantiate";

export type SprintLaunchInput = {
  workspaceId: string;
  clientId: string;
  theme: string;
  templateId?: string;
  targetCount?: number;
  durationDays?: number;
  startDate?: Date;
  userId: string;
};

export type SprintPostSummary = {
  contentId: string;
  ideaId: string;
  title: string;
  type: ContentTypeValue;
  pillar: string;
  scheduledFor: Date;
  complianceStatus: "passed" | "flagged" | "pending";
  complianceViolationsCount: number;
};

export type SprintLaunchResult = {
  ok: true;
  runId: string;
  runName: string;
  clientId: string;
  posts: SprintPostSummary[];
};

/**
 * Calculates evenly distributed future dates for the sprint schedule.
 */
function calculateDistributedDates(
  startDate: Date,
  durationDays: number,
  count: number,
): Date[] {
  const dates: Date[] = [];
  const startMs = startDate.getTime();
  const stepDays = Math.max(1, Math.floor(durationDays / Math.max(1, count)));

  for (let i = 0; i < count; i++) {
    const postDate = new Date(startMs);
    postDate.setDate(postDate.getDate() + (i + 1) * stepDays);
    // Set default high-engagement posting time (11:00 AM local)
    postDate.setHours(11, 0, 0, 0);
    dates.push(postDate);
  }
  return dates;
}

const DEFAULT_BRAND_IDENTITY: BrandIdentity = {
  voice: "Confident, engaging, authentic",
  tone: "Professional yet conversational",
  audience: "Target consumers & community",
  pillars: ["Product Features", "Customer Stories", "Industry Insights", "Tips & How-Tos"],
  doNots: ["Over-promising", "Off-brand slang", "Low-resolution visuals"],
  formats: ["Reels", "Carousels", "Stories"],
};

/**
 * The Autopilot Campaign Sprint Engine:
 * From a single prompt/theme + client, assembles:
 * 1. Strategic Angles & Hooks via Ideation Agent.
 * 2. Multi-variant Captions, CTAs, and Visual Storyboards via Generation Agent (computed in memory).
 * 3. Pre-flight Brand Compliance Auditing (fail-closed/pending).
 * 4. SOP Template linkage via instantiateRun (Slice 3) or ad-hoc review pipeline fallback.
 * 5. Atomic DB persistence linking to SOP run, calendar schedule, and workflowStateId.
 * 6. Domain event emission per deliverable for reverse-sync and Inngest automations.
 */
export async function launchCampaignSprint(
  input: SprintLaunchInput,
): Promise<SprintLaunchResult> {
  const {
    workspaceId,
    clientId,
    theme,
    targetCount = 4,
    durationDays = 14,
    startDate = new Date(),
    userId,
  } = input;

  // 1. Verify Client
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.workspaceId, workspaceId), eq(clients.id, clientId)))
    .limit(1);

  if (!client) {
    throw new Error("Client not found in this workspace.");
  }

  // 2. Fetch Brand DNA profile
  const brandProfile = await getBrandProfile(workspaceId, clientId);
  const brandIdentity: BrandIdentity = brandProfile?.identity ?? DEFAULT_BRAND_IDENTITY;

  // 3. Resolve initial workflow state for Production Board visibility
  const workflowId = await ensureContentWorkflow(workspaceId);
  const initialStates = await initialStateQuery(workspaceId, workflowId);
  const workflowStateId = initialStates[0]?.toStateId ?? null;

  // 4. SOP Template linkage & step instantiation (Slice 3)
  let matchedTemplateId: string | null = null;
  let instantiatedSteps: InstantiatedStep[] = [];

  let loadedTemplate: LoadedSopTemplate | null = null;
  if (input.templateId) {
    loadedTemplate = await loadSopTemplate(workspaceId, input.templateId);
  } else {
    // Look up active templates for the workspace
    const activeTemplates = await listSopTemplates(workspaceId);
    if (activeTemplates.length > 0) {
      // Prioritize campaign/sprint/content templates, or pick the first active
      const candidate =
        activeTemplates.find((t) =>
          /campaign|sprint|content/i.test(t.name),
        ) ?? activeTemplates[0];
      loadedTemplate = await loadSopTemplate(workspaceId, candidate.id);
    }
  }

  if (loadedTemplate && loadedTemplate.steps.length > 0) {
    matchedTemplateId = loadedTemplate.template.id;
    const members = await listWorkspaceMembers(workspaceId);
    const memberIds = new Set(members.map((m) => m.userId));
    instantiatedSteps = instantiateRun({
      steps: loadedTemplate.steps,
      anchorDate: startDate,
      isMember: (id) => memberIds.has(id),
      newId: () => crypto.randomUUID(),
    });
  }

  // 5. Generate strategic content ideas (IN MEMORY)
  const generatedIdeas = await generateIdeas({
    topic: theme,
    identity: brandIdentity,
    brief: `Campaign sprint theme: "${theme}". Target count: ${targetCount} posts over ${durationDays} days.`,
    drivers: [],
  });

  const selectedIdeas = generatedIdeas.slice(0, Math.min(Math.max(2, targetCount), 8));
  const scheduledDates = calculateDistributedDates(
    startDate,
    durationDays,
    selectedIdeas.length,
  );

  // 6. Pre-generate all drafts and audit compliance in memory (OUTSIDE DB TRANSACTION)
  const preparedDeliverables: Array<{
    ideaData: (typeof selectedIdeas)[number];
    scheduledDate: Date;
    contentType: ContentTypeValue;
    bodyMarkdown: string;
    complianceStatus: "passed" | "flagged" | "pending";
    violations: Array<{ rule: string; excerpt: string; why: string }>;
  }> = [];

  for (let i = 0; i < selectedIdeas.length; i++) {
    const ideaData = selectedIdeas[i];
    const scheduledDate = scheduledDates[i];

    const rawFormat = (ideaData.format || "post").toLowerCase();
    const contentType: ContentTypeValue =
      rawFormat.includes("reel") || rawFormat.includes("video")
        ? "reel"
        : rawFormat.includes("carousel")
        ? "carousel"
        : rawFormat.includes("story")
        ? "story"
        : "post";

    // AI Generation
    const draft = await generateDraft({
      idea: {
        hook: ideaData.hook,
        angle: ideaData.angle,
        format: ideaData.format,
      },
      identity: brandIdentity,
    });

    const bodyMarkdown = formatDraftBody(draft);

    // Compliance Scan (Fail-pending: never silently mark passed on error)
    let complianceStatus: "passed" | "flagged" | "pending" = "pending";
    let violations: Array<{ rule: string; excerpt: string; why: string }> = [];
    try {
      const complianceResult = await checkCompliance({
        draft,
        identity: brandIdentity,
      });
      violations = complianceResult.violations;
      complianceStatus = complianceResult.verdict === "pass" ? "passed" : "flagged";
    } catch {
      complianceStatus = "pending";
      violations = [
        {
          rule: "Audit Pending",
          excerpt: "",
          why: "Compliance scan encountered a transient error; run audit in Studio.",
        },
      ];
    }

    preparedDeliverables.push({
      ideaData,
      scheduledDate,
      contentType,
      bodyMarkdown,
      complianceStatus,
      violations,
    });
  }

  const sprintPosts: SprintPostSummary[] = [];
  const runId = crypto.randomUUID();
  const runName = `${theme.trim()} — Sprint`;

  // 7. Atomic DB Write (Fast transaction containing only inserts)
  await db.transaction(async (tx) => {
    // A. Create SOP Run
    await tx.insert(sopRuns).values({
      id: runId,
      workspaceId,
      clientId,
      templateId: matchedTemplateId,
      name: runName,
      anchorDate: startDate,
      status: "active",
      startedById: userId,
    });

    // B. Persist each content draft & calendar slot
    for (let i = 0; i < preparedDeliverables.length; i++) {
      const item = preparedDeliverables[i];
      const { ideaData, scheduledDate, contentType, bodyMarkdown, complianceStatus, violations } = item;

      // Insert Idea
      const ideaId = crypto.randomUUID();
      await tx.insert(ideas).values({
        id: ideaId,
        workspaceId,
        clientId,
        topic: theme,
        hook: ideaData.hook,
        angle: ideaData.angle,
        format: ideaData.format,
        whyReason: ideaData.why.reason,
        citations: ideaData.why.citations,
        status: "drafted",
      });

      // Insert Content Draft with real workflowStateId for Production Board visibility
      const contentId = crypto.randomUUID();
      await tx.insert(content).values({
        id: contentId,
        workspaceId,
        clientId,
        ideaId,
        type: contentType,
        title: `${ideaData.angle} (${ideaData.hook.slice(0, 30)}...)`,
        body: bodyMarkdown,
        status: "draft",
        workflowStateId,
        productionStage: "in_progress",
        pillar: brandIdentity.pillars[i % brandIdentity.pillars.length] || "Campaign",
        strategyNote: `${ideaData.why.reason} — Campaign Theme: ${theme}`,
        complianceStatus,
        complianceReport: violations,
        assigneeId: userId,
        dueAt: scheduledDate,
      });

      // Insert Calendar Slot
      await tx.insert(schedule).values({
        workspaceId,
        clientId,
        contentId,
        scheduledFor: scheduledDate,
      });

      sprintPosts.push({
        contentId,
        ideaId,
        title: `${ideaData.angle} (${ideaData.hook.slice(0, 30)}...)`,
        type: contentType,
        pillar: brandIdentity.pillars[i % brandIdentity.pillars.length] || "Campaign",
        scheduledFor: scheduledDate,
        complianceStatus,
        complianceViolationsCount: violations.length,
      });
    }

    // C. Persist SOP Steps (Slice 3):
    // If a canonical template is resolved, insert its instantiated steps.
    // Otherwise, fall back to the ad-hoc Polish + Sign-Off pipeline per deliverable.
    if (instantiatedSteps.length > 0) {
      await tx.insert(sopRunSteps).values(
        instantiatedSteps.map((s, idx) => ({
          id: s.id,
          workspaceId,
          runId,
          templateStepId: s.templateStepId,
          position: s.position,
          title: s.title,
          description: s.description,
          assigneeId: s.assigneeId ?? userId,
          assigneeRole: s.assigneeRole,
          dueAt: s.dueAt,
          status: s.status,
          gate: s.gate,
          creates: s.creates,
          completesWhen: s.completesWhen,
          dependsOn: s.dependsOn,
          linkedType: s.creates === "content" || s.gate !== "none" ? "content" : null,
          linkedId:
            (s.creates === "content" || s.gate !== "none") && sprintPosts.length > 0
              ? sprintPosts[idx % sprintPosts.length].contentId
              : null,
        })),
      );
    } else {
      let stepPosition = 0;
      for (let i = 0; i < sprintPosts.length; i++) {
        const post = sprintPosts[i];
        const item = preparedDeliverables[i];

        // Step 1: Polish & Creative Review
        const reviewStepId = crypto.randomUUID();
        await tx.insert(sopRunSteps).values({
          id: reviewStepId,
          workspaceId,
          runId,
          position: stepPosition++,
          title: `Polish Draft: ${item.ideaData.hook.slice(0, 35)}`,
          description: `Review AI-generated caption, visual cues, and compliance meter for ${item.contentType}.`,
          assigneeId: userId,
          dueAt: addBusinessDays(post.scheduledFor, -2),
          status: "ready",
          gate: "compliance",
          creates: "content",
          linkedType: "content",
          linkedId: post.contentId,
          completesWhen: { kind: "manual" },
          dependsOn: [],
        });

        // Step 2: Client Sign-Off & Approvals
        const approveStepId = crypto.randomUUID();
        await tx.insert(sopRunSteps).values({
          id: approveStepId,
          workspaceId,
          runId,
          position: stepPosition++,
          title: `Client Sign-Off: ${item.ideaData.angle}`,
          description: `Ensure content is reviewed and approved before scheduled slot.`,
          assigneeId: userId,
          dueAt: addBusinessDays(post.scheduledFor, -1),
          status: "blocked",
          gate: "approval",
          creates: "none",
          linkedType: "content",
          linkedId: post.contentId,
          completesWhen: { kind: "manual" },
          dependsOn: [reviewStepId],
        });
      }
    }
  });

  // 8. Post-commit: emit domain events for ALL generated deliverables
  for (const post of sprintPosts) {
    await emitDomainEvent({
      verb: "slot.scheduled",
      workspaceId,
      subjectType: "content",
      subjectId: post.contentId,
      slotDate: post.scheduledFor,
      actorId: userId,
      meta: {
        runId,
        pillar: post.pillar,
        complianceStatus: post.complianceStatus,
        source: matchedTemplateId ? "template_sprint" : "adhoc_sprint",
        templateId: matchedTemplateId,
      },
    });
  }

  return {
    ok: true,
    runId,
    runName,
    clientId,
    posts: sprintPosts,
  };
}
