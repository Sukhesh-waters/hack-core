"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { requireCapability } from "@/db/queries/memberships";
import {
  approveScanSpec,
  insertBrandChunk,
  insertCampaign,
  insertGateEvent,
  insertReceipt,
  insertScanSpec,
  recordReceiptOutcome,
  upsertWorkspaceConfig,
} from "@/db/queries/platina";
import { inngest } from "@/inngest/client";
import { hashGatePayload } from "@/lib/platina/hash";
import { GATE_CAPABILITY, assertCompleteGateEvent } from "@/lib/platina/gates";
import { proposeCampaignDetail } from "@/lib/platina/ideation";

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
  const id = await insertBrandChunk({ workspaceId: ws, content });
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

export async function createScanSpecAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const user = await requireUser();
  await requireCapability(ws, user.id, "gate.confirm");
  const name = String(formData.get("name") ?? "").trim();
  const value = String(formData.get("target") ?? "").trim();
  if (!name || !value) refuse(ws, "scans", "Name and target are required.");
  await insertScanSpec({
    workspaceId: ws,
    name,
    createdById: user.id,
    targets: [{ kind: "competitor_site", value }],
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
  await inngest.send({
    name: "platina/scan.requested",
    data: { specId, workspaceId: ws },
  });
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
  const evidenceBrand = String(formData.get("evidenceBrandIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const evidenceBrain = String(formData.get("evidenceBrainIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!title || !hypothesis) {
    refuse(ws, "ideation", "Title and hypothesis are required.");
  }
  if (evidenceBrand.length === 0) {
    refuse(ws, "ideation", "A plane-A evidence anchor is required.");
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
