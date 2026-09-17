/**
 * Assemble an action packet from workspace-scoped rows (Slice 6). Shared by
 * the printable export page and the packet.json route — one assembly, two
 * renderings of the same contract.
 */
import {
  getBrainChunksByIds,
  getBrandChunksByIds,
  getCampaign,
  getReceipt,
  getWorkspaceProfile,
  listGateEventsForSubject,
  listSolutionTasks,
  listSyntheticOutcomeIds,
} from "@/db/queries/platina";
import { claimsGate } from "../claims-gate";
import { buildActionPacket, type ActionPacket } from "./packet";

const GATE_STEP_LABEL = {
  declare: "brand_standard_confirmed",
  confirm: "audit_scope_approved",
  approve: "direction_approved",
  publish: "ready_for_external_execution",
} as const;

export async function assembleActionPacket(
  workspaceId: string,
  campaignId: string,
  exportedBy: string,
): Promise<ActionPacket | null> {
  const campaign = await getCampaign(workspaceId, campaignId);
  if (!campaign) return null;

  const [receipt, tasks, gateEvents, profile, syntheticOutcomeIds] =
    await Promise.all([
      campaign.receiptId
        ? getReceipt(workspaceId, campaign.receiptId)
        : Promise.resolve(null),
      listSolutionTasks(workspaceId, campaignId),
      listGateEventsForSubject(workspaceId, campaignId),
      getWorkspaceProfile(workspaceId),
      listSyntheticOutcomeIds(workspaceId),
    ]);

  // The receipt's own gate events complete the approval trail (direction
  // approval is recorded against the receipt, not the campaign).
  const receiptEvents = receipt
    ? await listGateEventsForSubject(workspaceId, receipt.id)
    : [];
  const allEvents = [...gateEvents, ...receiptEvents].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const [brandChunks, brainChunks] = await Promise.all([
    getBrandChunksByIds(workspaceId, receipt?.evidenceBrandIds ?? []),
    getBrainChunksByIds(workspaceId, receipt?.evidenceBrainIds ?? []),
  ]);

  const claims = claimsGate({
    contentPlan: campaign.contentPlan,
    taskTitles: tasks.map((t) => t.title),
    hasException: allEvents.some(
      (e) => e.subjectType === "claims_exception" && e.decision === "approved",
    ),
  });

  return buildActionPacket({
    workspaceId,
    solutionId: campaign.id,
    title: campaign.title,
    problemStatement: receipt?.hypothesis ?? campaign.title,
    findingRefs: receipt?.findingId ? [receipt.findingId] : [],
    affectedScope: {
      division: profile?.division ?? undefined,
      region: profile?.region ?? undefined,
      event: campaign.eventLabel ?? undefined,
      campaign: campaign.title,
    },
    severity: (receipt?.severity as ActionPacket["severity"]) ?? "medium",
    urgency: (receipt?.urgency as ActionPacket["urgency"]) ?? "this_quarter",
    approvedEvidenceRefs: [
      ...brandChunks.map((c) => ({
        id: c.id,
        kind: "brand_chunk" as const,
        note: c.content.slice(0, 80),
      })),
      ...(receipt
        ? [{ id: receipt.id, kind: "receipt" as const, note: receipt.title }]
        : []),
    ],
    unvalidatedMarketSignalRefs: brainChunks.map((c) => ({
      id: c.id,
      kind: "brain_chunk" as const,
      note: c.content.slice(0, 80),
    })),
    syntheticOutcomeIds,
    strongestUncertainty: receipt?.strongestUncertainty ?? "Not recorded.",
    actionSteps: tasks.map((t) => ({
      title: t.title,
      owner: t.assigneeId ?? "unassigned",
      dueDate: (t.dueDate ?? campaign.eventAnchor ?? new Date()).toISOString(),
      ...(t.eventPhase ? { eventPhase: t.eventPhase } : {}),
      status: t.status,
    })),
    owner: receipt?.ownerId ?? exportedBy,
    reviewers: [],
    dueDate: (receipt?.reviewAt ?? campaign.updatedAt).toISOString(),
    ...(campaign.eventAnchor
      ? {
          eventAnchor: {
            at: campaign.eventAnchor.toISOString(),
            label: campaign.eventLabel ?? "Event",
          },
        }
      : {}),
    expectedOutcome: receipt?.expectedOutcome ?? campaign.title,
    measurementPlan: {
      method: receipt?.measurementMethod ?? "Not recorded",
      reviewDate: (receipt?.reviewAt ?? campaign.updatedAt).toISOString(),
    },
    claimsStatus: {
      // A flagged solution with a recorded exception is still flagged — the
      // exception is visible in the exceptions array, not hidden by the verdict.
      verdict: claims.verdict,
      blockingViolations: claims.violations,
      exceptions: allEvents
        .filter(
          (e) => e.subjectType === "claims_exception" && e.decision === "approved",
        )
        .map((e) => ({
          rule: "claims_exception",
          approverId: e.approverId,
          reason: e.reason ?? "",
          at: e.createdAt.toISOString(),
        })),
    },
    approvals: allEvents
      .filter((e) => e.gate in GATE_STEP_LABEL)
      .map((e) => ({
        step: GATE_STEP_LABEL[e.gate as keyof typeof GATE_STEP_LABEL],
        decision: e.decision,
        approverId: e.approverId,
        at: e.createdAt.toISOString(),
        payloadHash: e.payloadHash,
      })),
    provenance: {
      signalDocumentIds: [],
      transcriptIds: brainChunks
        .map((c) => c.transcriptId)
        .filter((id): id is string => Boolean(id)),
      brainChunkIds: brainChunks.map((c) => c.id),
      receiptId: receipt?.id,
      gateEventIds: allEvents.map((e) => e.id),
    },
    exportedBy,
  });
}
