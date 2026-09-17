/**
 * Action-packet builder (Slice 6) — implements the Slice 0 W0.5 contract
 * exactly. The packet is the only thing Platina hands to the outside world:
 * a versioned JSON document plus a printable view. It never embeds raw
 * public (Plane B) content — provenance is by identifier only.
 *
 * Two hard rules enforced here:
 * - The evidence buckets can never merge: approved evidence and unvalidated
 *   market signals are separate constructor inputs and separate output
 *   arrays with disjoint `kind` unions.
 * - A synthetic-labelled outcome id in approvedEvidenceRefs throws (A4) —
 *   a packet built on demo data must not exist.
 */

export const PACKET_VERSION = "1.0.0";

export type PacketEvidenceRef = {
  id: string;
  kind: "brand_chunk" | "outcome" | "receipt";
  note?: string;
};

export type PacketSignalRef = {
  id: string;
  kind: "brain_chunk" | "transcript";
  note?: string;
};

export type PacketTask = {
  title: string;
  owner: string;
  dueDate: string;
  eventPhase?: "pre" | "at" | "post";
  status: "todo" | "in_progress" | "blocked" | "review" | "done";
};

export type PacketApproval = {
  step:
    | "brand_standard_confirmed"
    | "audit_scope_approved"
    | "direction_approved"
    | "ready_for_external_execution";
  decision: "approved" | "rejected";
  approverId: string;
  at: string;
  payloadHash: string;
};

export type ActionPacket = {
  packetVersion: typeof PACKET_VERSION;
  packetId: string;
  workspaceId: string;
  solutionId: string;
  title: string;
  problemStatement: string;
  findingRefs: string[];
  affectedScope: {
    division?: string;
    region?: string;
    product?: string;
    event?: string;
    campaign?: string;
  };
  severity: "critical" | "high" | "medium" | "low";
  urgency: "immediate" | "this_quarter" | "monitor";
  evidence: {
    approvedEvidenceRefs: PacketEvidenceRef[];
    unvalidatedMarketSignalRefs: PacketSignalRef[];
  };
  unvalidatedDirection?: true;
  strongestUncertainty: string;
  actionSteps: PacketTask[];
  owner: string;
  reviewers: string[];
  dueDate: string;
  eventAnchor?: { at: string; label: string };
  expectedOutcome: string;
  measurementPlan: { method: string; reviewDate: string };
  claimsStatus: {
    verdict: "passed" | "flagged" | "not_run";
    blockingViolations: { rule: string; excerpt: string; why: string }[];
    exceptions: { rule: string; approverId: string; reason: string; at: string }[];
  };
  approvals: PacketApproval[];
  provenance: {
    signalDocumentIds: string[];
    transcriptIds: string[];
    brainChunkIds: string[];
    receiptId?: string;
    gateEventIds: string[];
    syntheticDataExcluded: true;
  };
  exportedAt: string;
  exportedBy: string;
};

export type BuildPacketInput = {
  workspaceId: string;
  solutionId: string;
  title: string;
  problemStatement: string;
  findingRefs: string[];
  affectedScope: ActionPacket["affectedScope"];
  severity: ActionPacket["severity"];
  urgency: ActionPacket["urgency"];
  approvedEvidenceRefs: PacketEvidenceRef[];
  unvalidatedMarketSignalRefs: PacketSignalRef[];
  /** Synthetic outcome ids in this workspace (A4 guard input). */
  syntheticOutcomeIds: string[];
  strongestUncertainty: string;
  actionSteps: PacketTask[];
  owner: string;
  reviewers: string[];
  dueDate: string;
  eventAnchor?: { at: string; label: string };
  expectedOutcome: string;
  measurementPlan: { method: string; reviewDate: string };
  claimsStatus: ActionPacket["claimsStatus"];
  approvals: PacketApproval[];
  provenance: Omit<ActionPacket["provenance"], "syntheticDataExcluded">;
  exportedBy: string;
  now?: Date;
};

export function buildActionPacket(input: BuildPacketInput): ActionPacket {
  const synthetic = new Set(input.syntheticOutcomeIds);
  const leaked = input.approvedEvidenceRefs.filter(
    (ref) => ref.kind === "outcome" && synthetic.has(ref.id),
  );
  if (leaked.length > 0) {
    throw new Error(
      `synthetic outcome(s) ${leaked.map((r) => r.id).join(", ")} cannot be approved evidence`,
    );
  }

  const packet: ActionPacket = {
    packetVersion: PACKET_VERSION,
    packetId: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    solutionId: input.solutionId,
    title: input.title,
    problemStatement: input.problemStatement,
    findingRefs: input.findingRefs,
    affectedScope: input.affectedScope,
    severity: input.severity,
    urgency: input.urgency,
    evidence: {
      approvedEvidenceRefs: input.approvedEvidenceRefs,
      unvalidatedMarketSignalRefs: input.unvalidatedMarketSignalRefs,
    },
    ...(input.approvedEvidenceRefs.length === 0
      ? { unvalidatedDirection: true as const }
      : {}),
    strongestUncertainty: input.strongestUncertainty,
    actionSteps: input.actionSteps,
    owner: input.owner,
    reviewers: input.reviewers,
    dueDate: input.dueDate,
    ...(input.eventAnchor ? { eventAnchor: input.eventAnchor } : {}),
    expectedOutcome: input.expectedOutcome,
    measurementPlan: input.measurementPlan,
    claimsStatus: input.claimsStatus,
    approvals: input.approvals,
    provenance: {
      ...input.provenance,
      syntheticDataExcluded: true,
    },
    exportedAt: (input.now ?? new Date()).toISOString(),
    exportedBy: input.exportedBy,
  };
  return packet;
}
