"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { requireCapability } from "@/db/queries/memberships";
import {
  approveScanSpec,
  createAuditRun,
  getFinding,
  getScanSpec,
  getWorkspaceConfig,
  insertBrandChunk,
  insertCampaign,
  insertGateEvent,
  insertReceipt,
  insertScanSpec,
  recordReceiptOutcome,
  transitionFinding,
  upsertWorkspaceConfig,
  upsertWorkspaceProfile,
} from "@/db/queries/platina";
import { inngest } from "@/inngest/client";
import { hashGatePayload } from "@/lib/platina/hash";
import { GATE_CAPABILITY, assertCompleteGateEvent } from "@/lib/platina/gates";
import { proposeCampaignDetail } from "@/lib/platina/ideation";
import {
  manualIdempotencyKey,
  snapshotRunConfig,
} from "@/lib/platina/orchestrator";
import { embedText } from "@/lib/platina/embed";
import {
  canTransitionFinding,
  FINDING_TRANSITIONS,
  FINDING_VERDICT_LABEL,
  isFindingVerdict,
  type FindingStatus,
} from "@/lib/platina/findings";
import { broadcastPlatinaSignal } from "@/lib/platina/realtime-server";

async function actor(ws: string, gate: keyof typeof GATE_CAPABILITY) {
  const user = await requireUser();
  await requireCapability(ws, user.id, GATE_CAPABILITY[gate]);
  return user;
}

/**
 * Form actions must resolve to void, so a rejected submission comes back as a
 * message on the page instead of a return value nothing reads.
 */
function refuse(ws: string, section: string, message: string): never {
  redirect(`/p/${ws}/${section}?error=${encodeURIComponent(message)}`);
}

export async function declareBrandAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const content = String(formData.get("content") ?? "").trim();
  const user = await actor(ws, "declare");
  if (!content) refuse(ws, "brand", "Brand standard is required.");
  // Embed at write time so semantic retrieval can anchor to this standard.
  // A router outage stores the chunk without a vector — never a fake one.
  const embedding = await embedText(content);
  const id = await insertBrandChunk({
    workspaceId: ws,
    content,
    embedding: embedding ?? undefined,
  });
  const event = {
    workspaceId: ws,
    gate: "declare" as const,
    decision: "approved" as const,
    approverId: user.id,
    payloadHash: hashGatePayload({ id, content }),
    subjectType: "brand_chunk",
    subjectId: id,
  };
  assertCompleteGateEvent(event);
  await insertGateEvent(event);
  revalidatePath(`/p/${ws}/brand`);
  revalidatePath(`/p/${ws}/admin/brand`);
  revalidatePath(`/p/${ws}`);
}

const SOURCE_KINDS = [
  "competitor_site",
  "press_release",
  "conference",
  "trade_editorial",
  "ad_library",
] as const;
const CADENCE_MINUTES = [5, 10, 15] as const;

export async function createScanSpecAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const user = await requireUser();
  await requireCapability(ws, user.id, "gate.confirm");
  const name = String(formData.get("name") ?? "").trim();
  const value = String(formData.get("target") ?? "").trim();
  const kind = String(formData.get("kind") ?? "");
  const cadenceMinutes = Number(formData.get("cadenceMinutes") ?? 5);
  if (!name || !value) refuse(ws, "audits", "Name and target are required.");
  if (!SOURCE_KINDS.includes(kind as (typeof SOURCE_KINDS)[number])) {
    refuse(ws, "audits", "Pick a valid source type.");
  }
  if (!CADENCE_MINUTES.includes(cadenceMinutes as 5 | 10 | 15)) {
    refuse(ws, "audits", "Cadence must be 5, 10, or 15 minutes.");
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  } catch {
    refuse(ws, "audits", "Target must be a valid http(s) URL.");
  }
  await insertScanSpec({
    workspaceId: ws,
    name,
    createdById: user.id,
    targets: [
      { kind: kind as (typeof SOURCE_KINDS)[number], value },
    ],
    cadenceMinutes,
  });
  revalidatePath(`/p/${ws}/scans`);
  revalidatePath(`/p/${ws}/audits`);
  revalidatePath(`/p/${ws}`);
}

export async function confirmScanAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const specId = String(formData.get("specId"));
  const user = await actor(ws, "confirm");
  await approveScanSpec(ws, specId);
  const event = {
    workspaceId: ws,
    gate: "confirm" as const,
    decision: "approved" as const,
    approverId: user.id,
    payloadHash: hashGatePayload({ specId }),
    subjectType: "scan_spec",
    subjectId: specId,
  };
  assertCompleteGateEvent(event);
  await insertGateEvent(event);
  // Approval kicks off the first run immediately; cadence takes over after.
  const config = await getWorkspaceConfig(ws);
  const runId = await createAuditRun({
    workspaceId: ws,
    specId,
    trigger: "event",
    idempotencyKey: `approved:${specId}:${Date.now()}`,
    configSnapshot: snapshotRunConfig(config),
  });
  if (runId) {
    await inngest.send({
      name: "platina/audit-run.requested",
      data: { runId, workspaceId: ws },
    });
    await broadcastPlatinaSignal(ws, "audits", runId);
  }
  revalidatePath(`/p/${ws}/scans`);
  revalidatePath(`/p/${ws}/audits`);
  revalidatePath(`/p/${ws}`);
}

export async function approveDirectionAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const user = await actor(ws, "approve");
  const title = String(formData.get("title") ?? "").trim();
  const hypothesis = String(formData.get("hypothesis") ?? "").trim();
  const expected = String(formData.get("expectedOutcome") ?? "").trim();
  const findingId = String(formData.get("findingId") ?? "").trim() || null;
  const severity = String(formData.get("severity") ?? "").trim() || null;
  const urgency = String(formData.get("urgency") ?? "").trim() || null;
  const strongestUncertainty =
    String(formData.get("strongestUncertainty") ?? "").trim() || null;
  const measurementMethod =
    String(formData.get("measurementMethod") ?? "").trim() || null;
  const evidenceBrand = String(formData.get("evidenceBrandIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const evidenceBrain = String(formData.get("evidenceBrainIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!title || !hypothesis) {
    refuse(ws, "solutions/new", "Title and hypothesis are required.");
  }
  if (evidenceBrand.length === 0) {
    refuse(ws, "solutions/new", "A plane-A evidence anchor is required.");
  }
  const reviewAt = new Date(Date.now() + 90 * 86_400_000);
  const id = await insertReceipt({
    workspaceId: ws,
    title,
    hypothesis,
    expectedOutcome: expected || hypothesis,
    evidenceBrandIds: evidenceBrand,
    evidenceBrainIds: evidenceBrain,
    reviewAt,
    ownerId: user.id,
    findingId,
    severity,
    urgency,
    strongestUncertainty,
    measurementMethod,
  });
  const detail = proposeCampaignDetail({ title, hypothesis });
  const campaignId = await insertCampaign({
    workspaceId: ws,
    title,
    receiptId: id,
    ...detail,
  });
  const event = {
    workspaceId: ws,
    gate: "approve" as const,
    decision: "approved" as const,
    approverId: user.id,
    payloadHash: hashGatePayload({ id, campaignId }),
    subjectType: "receipt",
    subjectId: id,
  };
  assertCompleteGateEvent(event);
  await insertGateEvent(event);
  revalidatePath(`/p/${ws}/receipts`);
  revalidatePath(`/p/${ws}/campaigns`);
  revalidatePath(`/p/${ws}/solutions`);
  revalidatePath(`/p/${ws}/solutions/new`);
  revalidatePath(`/p/${ws}/outcomes`);
  revalidatePath(`/p/${ws}`);
}

export async function publishCampaignAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const campaignId = String(formData.get("campaignId"));
  const user = await actor(ws, "publish");
  const event = {
    workspaceId: ws,
    gate: "publish" as const,
    decision: "approved" as const,
    approverId: user.id,
    payloadHash: hashGatePayload({ campaignId }),
    subjectType: "campaign",
    subjectId: campaignId,
  };
  assertCompleteGateEvent(event);
  await insertGateEvent(event);
  revalidatePath(`/p/${ws}/campaigns`);
  revalidatePath(`/p/${ws}/solutions`);
  revalidatePath(`/p/${ws}`);
}

const RECEIPT_OUTCOMES = ["worked", "did_not_work", "inconclusive"] as const;

export async function gradeReceiptAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const user = await requireUser();
  await requireCapability(ws, user.id, "gate.approve");
  const receiptId = String(formData.get("receiptId"));
  const submitted = String(formData.get("outcome"));
  const outcome = RECEIPT_OUTCOMES.find((o) => o === submitted);
  if (!outcome) refuse(ws, "receipts", "Pick a valid outcome.");
  await recordReceiptOutcome({ workspaceId: ws, receiptId, outcome });
  revalidatePath(`/p/${ws}/receipts`);
  revalidatePath(`/p/${ws}/outcomes`);
  revalidatePath(`/p/${ws}`);
}

export async function saveConfigAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const user = await requireUser();
  await requireCapability(ws, user.id, "gate.approve");
  await upsertWorkspaceConfig(ws, {
    minBaselineN: Number(formData.get("minBaselineN") ?? 20),
    contestedFloor: Number(formData.get("contestedFloor") ?? 0.4),
    qualifiedFloor: Number(formData.get("qualifiedFloor") ?? 0.7),
  });
  revalidatePath(`/p/${ws}/admin`);
}

export async function saveProfileAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const user = await requireUser();
  await requireCapability(ws, user.id, "gate.approve");
  await upsertWorkspaceProfile(ws, {
    division: String(formData.get("division") ?? "").trim() || undefined,
    region: String(formData.get("region") ?? "").trim() || undefined,
    businessUnit:
      String(formData.get("businessUnit") ?? "").trim() || undefined,
  });
  revalidatePath(`/p/${ws}/admin`);
  revalidatePath(`/p/${ws}`);
}

/**
 * Human review of a finding: validate, rule out, dismiss, or supersede.
 * Guarded in SQL by the transition table — illegal and repeat transitions
 * return null and come back as a visible refusal. A note is always required:
 * the note is the audit trail.
 */
export async function reviewFindingAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const findingId = String(formData.get("findingId"));
  const verdict = String(formData.get("verdict") ?? "");
  const ruling = String(formData.get("ruling") ?? "").trim();
  const user = await requireUser();
  await requireCapability(ws, user.id, "gate.approve");
  if (!isFindingVerdict(verdict)) {
    refuse(ws, "findings", "Pick a valid review action.");
  }
  if (!ruling) {
    refuse(ws, "findings", "A review note is required — it is the audit trail.");
  }
  const finding = await getFinding(ws, findingId);
  if (!finding) refuse(ws, "findings", "Finding not found.");
  if (!canTransitionFinding(finding.status as FindingStatus, verdict)) {
    refuse(
      ws,
      "findings",
      `Cannot ${FINDING_VERDICT_LABEL[verdict].toLowerCase()} a finding in state "${finding.status}".`,
    );
  }
  const transitioned = await transitionFinding({
    workspaceId: ws,
    findingId,
    from: FINDING_TRANSITIONS[finding.status as FindingStatus],
    to: verdict,
    ruling,
    ruledBy: user.id,
  });
  if (!transitioned) {
    refuse(ws, "findings", "This finding changed state — refresh and retry.");
  }
  await broadcastPlatinaSignal(ws, "findings", findingId);
  revalidatePath(`/p/${ws}/findings`);
  revalidatePath(`/p/${ws}`);
}

/**
 * Manual "Run now". Creates one durable queued run with a frozen config
 * snapshot and a minute-bucketed idempotency key, then dispatches the
 * worker. Approval is not bypassed: only an approved source can run.
 */
export async function runAuditNowAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const specId = String(formData.get("specId"));
  const user = await requireUser();
  await requireCapability(ws, user.id, "gate.confirm");

  const spec = await getScanSpec(ws, specId);
  if (!spec) refuse(ws, "audits", "Audit source not found.");
  if (spec.status !== "approved") {
    refuse(ws, "audits", "Approve the audit scope before running it.");
  }

  const config = await getWorkspaceConfig(ws);
  const runId = await createAuditRun({
    workspaceId: ws,
    specId,
    trigger: "manual",
    idempotencyKey: manualIdempotencyKey(specId),
    configSnapshot: snapshotRunConfig(config),
  });
  if (!runId) {
    refuse(
      ws,
      "audits",
      "A run for this source was already queued in the last minute.",
    );
  }
  await inngest.send({
    name: "platina/audit-run.requested",
    data: { runId, workspaceId: ws },
  });
  await broadcastPlatinaSignal(ws, "audits", runId);
  revalidatePath(`/p/${ws}/audits`);
  revalidatePath(`/p/${ws}`);
}
