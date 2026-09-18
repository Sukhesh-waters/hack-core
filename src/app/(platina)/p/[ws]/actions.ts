"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { requireCapability } from "@/db/queries/memberships";
import {
  approveBrandSource,
  approveScanSpec,
  archiveClaimsRule,
  closeDraftCampaign,
  createAuditRun,
  demoteBrainChunk,
  findInvalidCitationIds,
  getBrandSource,
  getCampaign,
  getFinding,
  getReceipt,
  getScanSpec,
  getWorkspaceConfig,
  hasClaimsException,
  insertBrandChunk,
  insertBrandSource,
  insertCampaign,
  insertClaimsRule,
  insertFinding,
  insertGateEvent,
  insertOutcome,
  insertOutcomeImport,
  insertReceipt,
  insertScanSpec,
  insertSolutionTask,
  insertAlertRule,
  listActiveClaimsRules,
  listBrandChunks,
  listOutcomeDedupeRows,
  listSolutionTasks,
  listTemplateTaskTitles,
  markCampaignPlanned,
  recordReceiptOutcome,
  setAlertRuleEnabled,
  transitionFinding,
  updateDraftCampaign,
  updateSolutionTask,
  upsertWorkspaceConfig,
  upsertWorkspaceProfile,
} from "@/db/queries/platina";
import { inngest } from "@/inngest/client";
import { hashGatePayload } from "@/lib/platina/hash";
import { GATE_CAPABILITY, assertCompleteGateEvent } from "@/lib/platina/gates";
import { proposeCampaignDetail } from "@/lib/platina/ideation";
import type { Capability } from "@/lib/permissions";
import {
  manualIdempotencyKey,
  snapshotRunConfig,
} from "@/lib/platina/orchestrator";
import { embedText } from "@/lib/platina/embed";
import { chunkProse } from "@/lib/platina/chunking";
import { claimsGate, claimsDnaFromRules } from "@/lib/platina/claims-gate";
import { getConferencePreset } from "@/lib/platina/presets";
import { auditCopyAgainstStandard } from "@/lib/platina/drift";
import { runBrandExtraction } from "@/lib/platina/brand-extract";
import { blockersFor, eventTaskTemplate, isBoardStatus, templateDueDate } from "@/lib/platina/tasks";
import {
  ALERT_SOURCE_FIELDS,
  isAlertSource,
} from "@/lib/platina/alerts";
import {
  leadQualityScore,
  outcomeRowHash,
  parseOutcomeCsv,
} from "@/lib/platina/outcomes";
import {
  DEMOTED_CONFIDENCE_FLOOR,
  gradingWriteback,
} from "@/lib/platina/writeback";
import { contentHash } from "@/lib/platina/fetch/canonical";
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

/** Operational (non-gate) actions authorize against the Platina capability
 *  set — the Slice 10 role policy. Gate-writing actions keep gate.*. */
async function operator(ws: string, capability: Capability) {
  const user = await requireUser();
  await requireCapability(ws, user.id, capability);
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
  // R4.5: long declarations split on paragraph boundaries; each chunk is
  // embedded at write time. A router outage stores without a vector —
  // never a fake one.
  const chunks = chunkProse(content);
  let lastId = "";
  for (const [index, chunk] of chunks.entries()) {
    const embedding = await embedText(chunk);
    lastId = await insertBrandChunk({
      workspaceId: ws,
      content: chunk,
      embedding: embedding ?? undefined,
      chunkIndex: index,
    });
  }
  const id = lastId;
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
  await requireCapability(ws, user.id, "platina.audit.manage");
  const presetKey = String(formData.get("preset") ?? "").trim();
  const preset = presetKey ? getConferencePreset(presetKey) : null;
  if (presetKey && !preset) {
    refuse(ws, "audits", "Unknown conference preset.");
  }
  const name = (preset?.name ?? String(formData.get("name") ?? "")).trim();
  const value = (preset?.url ?? String(formData.get("target") ?? "")).trim();
  const kind = preset ? "conference" : String(formData.get("kind") ?? "");
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
  const user = await operator(ws, "platina.audit.manage");
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
  const user = await operator(ws, "platina.solution.approve");
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
  // Citation ids arrive as hidden form fields — validate them against this
  // workspace's rows before they persist anywhere.
  const invalid = await findInvalidCitationIds(ws, evidenceBrand, evidenceBrain);
  if (invalid.length > 0) {
    refuse(
      ws,
      "solutions/new",
      "One or more cited evidence records do not belong to this workspace. Reload and redraft.",
    );
  }
  const useCase = String(formData.get("useCase") ?? "").trim() || null;
  const eventAnchorRaw = String(formData.get("eventAnchor") ?? "").trim();
  const eventLabel = String(formData.get("eventLabel") ?? "").trim() || null;
  if (useCase === "event_readiness" && !eventAnchorRaw) {
    refuse(
      ws,
      "solutions/new",
      "An event-anchored solution needs the event date.",
    );
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
    useCase: useCase ?? undefined,
    ...detail,
    // Operator-set anchor wins over the template default.
    ...(eventAnchorRaw
      ? {
          eventAnchor: new Date(eventAnchorRaw),
          eventLabel: eventLabel ?? detail.eventLabel,
        }
      : {}),
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
  await broadcastPlatinaSignal(ws, "solutions", campaignId);
  revalidatePath(`/p/${ws}/receipts`);
  revalidatePath(`/p/${ws}/campaigns`);
  revalidatePath(`/p/${ws}/solutions`);
  revalidatePath(`/p/${ws}/solutions/new`);
  revalidatePath(`/p/${ws}/outcomes`);
  revalidatePath(`/p/${ws}`);
}

/** Edit a draft solution's plan fields. Only drafts are editable. */
export async function editSolutionAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const campaignId = String(formData.get("campaignId"));
  // The capability check is the authorization; no user id is written here.
  await operator(ws, "platina.solution.edit");
  const channelMix = String(formData.get("channelMix") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const updated = await updateDraftCampaign(ws, campaignId, {
    durationDays: Number(formData.get("durationDays")) || undefined,
    geography: String(formData.get("geography") ?? "").trim() || undefined,
    channelMix: channelMix.length > 0 ? channelMix : undefined,
    audience: String(formData.get("audience") ?? "").trim() || undefined,
    contentPlan: String(formData.get("contentPlan") ?? "").trim() || undefined,
    eventLabel: String(formData.get("eventLabel") ?? "").trim() || undefined,
    eventAnchor: String(formData.get("eventAnchor") ?? "").trim()
      ? new Date(String(formData.get("eventAnchor")))
      : undefined,
  });
  if (!updated) {
    refuse(ws, "solutions", "Only a draft solution can be edited.");
  }
  await broadcastPlatinaSignal(ws, "solutions", campaignId);
  revalidatePath(`/p/${ws}/solutions`);
  revalidatePath(`/p/${ws}`);
}

/**
 * Reject a draft solution: the draft closes and an immutable rejected
 * decision is recorded on the approve gate. Nothing is deleted.
 */
export async function rejectSolutionAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const campaignId = String(formData.get("campaignId"));
  const reason = String(formData.get("reason") ?? "").trim();
  const user = await operator(ws, "platina.execution.approve");
  if (!reason) {
    refuse(ws, "solutions", "A rejection reason is required — it is the audit trail.");
  }
  const closed = await closeDraftCampaign(ws, campaignId);
  if (!closed) {
    refuse(ws, "solutions", "Only a draft solution can be rejected.");
  }
  const event = {
    workspaceId: ws,
    gate: "approve" as const,
    decision: "rejected" as const,
    approverId: user.id,
    payloadHash: hashGatePayload({ campaignId, reason }),
    subjectType: "campaign",
    subjectId: campaignId,
    reason,
  };
  assertCompleteGateEvent(event);
  await insertGateEvent(event);
  await broadcastPlatinaSignal(ws, "solutions", campaignId);
  revalidatePath(`/p/${ws}/solutions`);
  revalidatePath(`/p/${ws}`);
}

export async function publishCampaignAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const campaignId = String(formData.get("campaignId"));
  const user = await operator(ws, "platina.execution.approve");

  // Final approval is gated on real state: no open blocking work, and no
  // unresolved deterministic claims violation without a named exception.
  const campaign = await getCampaign(ws, campaignId);
  if (!campaign) refuse(ws, "solutions", "Solution not found.");
  const tasks = await listSolutionTasks(ws, campaignId);
  const blockers = blockersFor(tasks);
  if (blockers.blocked) {
    refuse(
      ws,
      "solutions",
      `Final approval is blocked: ${blockers.reasons.join("; ")}.`,
    );
  }
  const gate = claimsGate({
    contentPlan: campaign.contentPlan,
    taskTitles: tasks.map((t) => t.title),
    hasException: await hasClaimsException(ws, campaignId),
    dna: claimsDnaFromRules(await listActiveClaimsRules(ws)).dna,
  });
  if (gate.blocksApproval) {
    refuse(
      ws,
      "solutions",
      `Claims review flags this solution: ${gate.violations
        .map((v) => v.why)
        .join("; ")}. Resolve or record a named exception first.`,
    );
  }

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
  await markCampaignPlanned(ws, campaignId);
  await broadcastPlatinaSignal(ws, "solutions", campaignId);
  revalidatePath(`/p/${ws}/campaigns`);
  revalidatePath(`/p/${ws}/solutions`);
  revalidatePath(`/p/${ws}/solutions/${campaignId}`);
  revalidatePath(`/p/${ws}`);
}

const RECEIPT_OUTCOMES = ["worked", "did_not_work", "inconclusive"] as const;

export async function gradeReceiptAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const user = await requireUser();
  await requireCapability(ws, user.id, "platina.outcome.import");
  const receiptId = String(formData.get("receiptId"));
  const submitted = String(formData.get("outcome"));
  const outcome = RECEIPT_OUTCOMES.find((o) => o === submitted);
  if (!outcome) refuse(ws, "outcomes", "Pick a valid outcome.");
  const outcomeNote = String(formData.get("outcomeNote") ?? "").trim() || undefined;

  // Guarded pending → graded: the write-back below runs exactly once.
  const graded = await recordReceiptOutcome({
    workspaceId: ws,
    receiptId,
    outcome,
    outcomeNote,
  });
  if (!graded) {
    refuse(ws, "outcomes", "This receipt is already graded — verdicts are final.");
  }

  // Write the measured result back into first-party evidence (Plane A), and
  // demote contradicted hypotheses (R5.3) — retained, floored, excluded from
  // retrieval, linked to the receipt that contradicted them.
  const receipt = await getReceipt(ws, receiptId);
  if (receipt) {
    const plan = gradingWriteback(receipt, outcome, outcomeNote);
    const embedding = await embedText(plan.evidenceContent);
    await insertBrandChunk({
      workspaceId: ws,
      content: plan.evidenceContent,
      sourceUrl: `outcome://${receiptId}`,
      title: `Measured outcome — ${receipt.title}`,
      embedding: embedding ?? undefined,
    });
    for (const chunkId of plan.demoteBrainChunkIds) {
      await demoteBrainChunk(ws, chunkId, receiptId, DEMOTED_CONFIDENCE_FLOOR);
    }
  }

  await broadcastPlatinaSignal(ws, "outcomes", receiptId);
  revalidatePath(`/p/${ws}/receipts`);
  revalidatePath(`/p/${ws}/outcomes`);
  revalidatePath(`/p/${ws}`);
}

/**
 * Consented outcome import (pasted CSV). Validates the schema strictly,
 * dedupes by row content hash against existing rows, records provenance on
 * the import row, and never marks any of it synthetic — this is consented
 * first-party data. Members cannot import authoritative outcomes.
 */
export async function importOutcomesAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const user = await requireUser();
  await requireCapability(ws, user.id, "platina.outcome.import");
  const csv = String(formData.get("csv") ?? "").trim();
  if (!csv) refuse(ws, "outcomes", "Paste the outcome CSV to import.");

  const parsed = parseOutcomeCsv(csv);
  const existing = new Set(
    (await listOutcomeDedupeRows(ws)).map((r) =>
      outcomeRowHash({
        ...r,
        campaignId: r.campaignId ?? undefined,
        receiptId: r.receiptId ?? undefined,
        recordedAt: r.recordedAt,
        conversionRate: r.conversionRate ?? undefined,
        pipelineContribution: r.pipelineContribution ?? undefined,
      }),
    ),
  );

  let inserted = 0;
  let skipped = 0;
  const errors = [...parsed.errors];
  for (const row of parsed.rows) {
    if (existing.has(outcomeRowHash(row))) {
      skipped += 1;
      continue;
    }
    await insertOutcome({
      workspaceId: ws,
      campaignId: row.campaignId,
      receiptId: row.receiptId,
      leads: row.leads,
      qualifiedLeads: row.qualifiedLeads,
      conversionRate: row.conversionRate,
      pipelineContribution: row.pipelineContribution,
      qualityScore: row.qualityScore ?? leadQualityScore(row),
      recordedAt: row.recordedAt,
      source: "csv-paste",
    });
    inserted += 1;
  }

  await insertOutcomeImport({
    workspaceId: ws,
    source: "csv-paste",
    fileHash: contentHash("outcome-import", csv),
    status: "completed",
    rowCount: parsed.rows.length,
    insertedCount: inserted,
    skippedCount: skipped,
    errors,
    createdById: user.id,
  });
  await broadcastPlatinaSignal(ws, "outcomes");
  revalidatePath(`/p/${ws}/outcomes`);
  revalidatePath(`/p/${ws}`);
}

export async function saveConfigAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const user = await requireUser();
  await requireCapability(ws, user.id, "platina.config.manage");
  // The analysis sequence is the stored order filtered to the steps the
  // operator left enabled — order is preserved, not re-invented.
  const promptVersion = Number(formData.get("promptVersion") ?? 1);
  await upsertWorkspaceConfig(ws, {
    minBaselineN: Number(formData.get("minBaselineN") ?? 20),
    contestedFloor: Number(formData.get("contestedFloor") ?? 0.4),
    qualifiedFloor: Number(formData.get("qualifiedFloor") ?? 0.7),
    similarityFloor: Number(formData.get("similarityFloor") ?? 0.35),
    ...(promptVersion >= 1
      ? { promptVersion: Math.floor(promptVersion) }
      : {}),
  });
  // Configuration history: every change is a recorded, attributed event.
  const event = {
    workspaceId: ws,
    gate: "confirm" as const,
    decision: "approved" as const,
    approverId: user.id,
    payloadHash: hashGatePayload({
      minBaselineN: Number(formData.get("minBaselineN") ?? 20),
      promptVersion,
      at: Date.now(),
    }),
    subjectType: "workspace_config",
    subjectId: ws,
  };
  assertCompleteGateEvent(event);
  await insertGateEvent(event);
  revalidatePath(`/p/${ws}/admin`);
}

export async function saveProfileAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const user = await requireUser();
  await requireCapability(ws, user.id, "platina.config.manage");
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
  await requireCapability(ws, user.id, "platina.finding.review");
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
  await requireCapability(ws, user.id, "platina.audit.run");

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

// ---------------------------------------------------------------------------
// Slice 6 — solution tasks and the claims exception
// ---------------------------------------------------------------------------

export async function addTaskAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const campaignId = String(formData.get("campaignId"));
  await requireCapability(ws, (await requireUser()).id, "platina.task.edit");
  const title = String(formData.get("title") ?? "").trim();
  if (!title) refuse(ws, `solutions/${campaignId}`, "Task title is required.");
  const phase = String(formData.get("eventPhase") ?? "");
  const dueDateRaw = String(formData.get("dueDate") ?? "").trim();
  await insertSolutionTask({
    workspaceId: ws,
    campaignId,
    title,
    assigneeId: String(formData.get("assigneeId") ?? "").trim() || null,
    dueDate: dueDateRaw ? new Date(dueDateRaw) : null,
    eventPhase: phase === "pre" || phase === "at" || phase === "post" ? phase : null,
    risk: String(formData.get("risk") ?? "").trim() || null,
    claimsBlocked: formData.get("claimsBlocked") === "on",
  });
  await broadcastPlatinaSignal(ws, "solutions", campaignId);
  revalidatePath(`/p/${ws}/solutions/${campaignId}`);
}

export async function moveTaskAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const campaignId = String(formData.get("campaignId"));
  const taskId = String(formData.get("taskId"));
  await requireCapability(ws, (await requireUser()).id, "platina.task.edit");
  const status = String(formData.get("status"));
  if (!isBoardStatus(status)) {
    refuse(ws, `solutions/${campaignId}`, "Pick a valid board column.");
  }
  const updated = await updateSolutionTask(ws, taskId, { status });
  if (!updated) refuse(ws, `solutions/${campaignId}`, "Task not found.");
  await broadcastPlatinaSignal(ws, "solutions", campaignId);
  revalidatePath(`/p/${ws}/solutions/${campaignId}`);
}

export async function updateTaskAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const campaignId = String(formData.get("campaignId"));
  const taskId = String(formData.get("taskId"));
  await requireCapability(ws, (await requireUser()).id, "platina.task.edit");
  const dueDateRaw = String(formData.get("dueDate") ?? "").trim();
  const phase = String(formData.get("eventPhase") ?? "");
  const updated = await updateSolutionTask(ws, taskId, {
    title: String(formData.get("title") ?? "").trim() || undefined,
    assigneeId: String(formData.get("assigneeId") ?? "").trim() || null,
    dueDate: dueDateRaw ? new Date(dueDateRaw) : null,
    eventPhase: phase === "pre" || phase === "at" || phase === "post" ? phase : null,
    risk: String(formData.get("risk") ?? "").trim() || null,
    claimsBlocked: formData.get("claimsBlocked") === "on",
  });
  if (!updated) refuse(ws, `solutions/${campaignId}`, "Task not found.");
  await broadcastPlatinaSignal(ws, "solutions", campaignId);
  revalidatePath(`/p/${ws}/solutions/${campaignId}`);
}

/**
 * Materialize the pre/at/post template for an event-anchored solution.
 * Idempotent per campaign: existing template titles are not duplicated.
 */
export async function materializeEventTasksAction(
  formData: FormData,
): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const campaignId = String(formData.get("campaignId"));
  await requireCapability(ws, (await requireUser()).id, "platina.task.edit");
  const campaign = await getCampaign(ws, campaignId);
  if (!campaign) refuse(ws, "solutions", "Solution not found.");
  if (!campaign.eventAnchor) {
    refuse(
      ws,
      `solutions/${campaignId}`,
      "Set an event anchor on the solution before materializing event tasks.",
    );
  }
  const existing = await listTemplateTaskTitles(ws, campaignId);
  const anchor = new Date(campaign.eventAnchor);
  let created = 0;
  for (const t of eventTaskTemplate()) {
    if (existing.has(t.title)) continue;
    await insertSolutionTask({
      workspaceId: ws,
      campaignId,
      title: t.title,
      eventPhase: t.eventPhase,
      dueDate: templateDueDate(anchor, t.offsetDays),
      claimsBlocked: t.claimsBlocked,
    });
    created += 1;
  }
  if (created === 0) {
    refuse(
      ws,
      `solutions/${campaignId}`,
      "The event task template is already materialized for this solution.",
    );
  }
  await broadcastPlatinaSignal(ws, "solutions", campaignId);
  revalidatePath(`/p/${ws}/solutions/${campaignId}`);
}

/**
 * A named-approver claims exception. The violation stays visible on the
 * Claims tab; the exception only unblocks final approval, with the reason
 * recorded immutably.
 */
export async function claimsExceptionAction(
  formData: FormData,
): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const campaignId = String(formData.get("campaignId"));
  const reason = String(formData.get("reason") ?? "").trim();
  const user = await operator(ws, "platina.execution.approve");
  if (!reason) {
    refuse(
      ws,
      `solutions/${campaignId}`,
      "An exception reason is required — it is the audit trail.",
    );
  }
  const event = {
    workspaceId: ws,
    gate: "publish" as const,
    decision: "approved" as const,
    approverId: user.id,
    payloadHash: hashGatePayload({ campaignId, reason }),
    subjectType: "claims_exception",
    subjectId: campaignId,
    reason,
  };
  assertCompleteGateEvent(event);
  await insertGateEvent(event);
  await broadcastPlatinaSignal(ws, "solutions", campaignId);
  revalidatePath(`/p/${ws}/solutions/${campaignId}`);
}

// ---------------------------------------------------------------------------
// Slice 8 — brand sources, workspace claims rules, copy audit
// ---------------------------------------------------------------------------

export async function addBrandSourceAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const user = await actor(ws, "declare");
  const title = String(formData.get("title") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const pasted = String(formData.get("pasted") ?? "").trim();
  if (!title) refuse(ws, "admin/brand", "A source title is required.");
  if (!url && !pasted) {
    refuse(ws, "admin/brand", "Provide a public URL or paste the standard text.");
  }
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error();
      }
    } catch {
      refuse(ws, "admin/brand", "The source URL must be a valid http(s) URL.");
    }
  }
  const sourceId = await insertBrandSource({
    workspaceId: ws,
    title,
    url: url || null,
    createdById: user.id,
  });
  // Pasted text is already the content — a draft source with pasted content
  // stores it on the URL field's absence; the content arrives at confirm time
  // via the same form. For pasted sources we extract immediately on confirm.
  revalidatePath(`/p/${ws}/admin/brand`);
  void sourceId;
}

/**
 * Confirm a brand source (gate: declare), then extract. URL sources fetch
 * through the Waters adapter as consented first-party content; pasted text
 * arrives with the form. Unchanged content produces no new chunks.
 */
export async function confirmBrandSourceAction(
  formData: FormData,
): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const sourceId = String(formData.get("sourceId"));
  const user = await actor(ws, "declare");
  const source = await getBrandSource(ws, sourceId);
  if (!source) refuse(ws, "admin/brand", "Source not found.");

  const pasted = String(formData.get("pasted") ?? "").trim();
  let content = pasted;
  if (!content && source.url) {
    const { fetchViaWaters } = await import("@/lib/platina/fetch/waters");
    const outcome = await fetchViaWaters({
      id: source.id,
      workspaceId: ws,
      status: "approved",
      targets: [{ kind: "competitor_site", value: source.url }],
    });
    content = outcome.docs.map((d) => d.body).join("\n\n");
  }
  if (!content) {
    refuse(
      ws,
      "admin/brand",
      "No content — paste the standard text or set a fetchable URL.",
    );
  }

  await approveBrandSource(ws, sourceId);
  const event = {
    workspaceId: ws,
    gate: "declare" as const,
    decision: "approved" as const,
    approverId: user.id,
    payloadHash: hashGatePayload({ sourceId }),
    subjectType: "brand_source",
    subjectId: sourceId,
  };
  assertCompleteGateEvent(event);
  await insertGateEvent(event);
  await runBrandExtraction(source, content);
  revalidatePath(`/p/${ws}/admin/brand`);
  revalidatePath(`/p/${ws}`);
}

/** Manual re-fetch of an approved URL source. Unchanged content produces no
 *  new chunks — only the freshness timestamp moves. */
export async function refreshBrandSourceAction(
  formData: FormData,
): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const sourceId = String(formData.get("sourceId"));
  await actor(ws, "declare");
  const source = await getBrandSource(ws, sourceId);
  if (!source || source.status !== "approved") {
    refuse(ws, "admin/brand", "Only an approved source can be refreshed.");
  }
  if (!source.url) {
    refuse(ws, "admin/brand", "A pasted source is refreshed by confirming new text.");
  }
  const { fetchViaWaters } = await import("@/lib/platina/fetch/waters");
  const outcome = await fetchViaWaters({
    id: source.id,
    workspaceId: ws,
    status: "approved",
    targets: [{ kind: "competitor_site", value: source.url }],
  });
  const content = outcome.docs.map((d) => d.body).join("\n\n");
  if (!content) {
    refuse(ws, "admin/brand", "The fetch returned no content — try again later.");
  }
  await runBrandExtraction(source, content);
  revalidatePath(`/p/${ws}/admin/brand`);
}

export async function addClaimsRuleAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const user = await operator(ws, "platina.config.manage");
  const kind = String(formData.get("kind") ?? "");
  const term = String(formData.get("term") ?? "").trim();
  if (kind !== "banned_term" && kind !== "regulated_claim") {
    refuse(ws, "admin/claims", "Pick a valid rule type.");
  }
  if (!term) refuse(ws, "admin/claims", "A rule term is required.");
  const id = await insertClaimsRule({
    workspaceId: ws,
    kind,
    term,
    note: String(formData.get("note") ?? "").trim() || null,
    createdById: user.id,
  });
  const event = {
    workspaceId: ws,
    gate: "declare" as const,
    decision: "approved" as const,
    approverId: user.id,
    payloadHash: hashGatePayload({ id, kind, term }),
    subjectType: "claims_rule",
    subjectId: id,
  };
  assertCompleteGateEvent(event);
  await insertGateEvent(event);
  revalidatePath(`/p/${ws}/admin/claims`);
}

export async function archiveClaimsRuleAction(
  formData: FormData,
): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const ruleId = String(formData.get("ruleId"));
  const user = await operator(ws, "platina.config.manage");
  const archived = await archiveClaimsRule(ws, ruleId);
  if (!archived) refuse(ws, "admin/claims", "Rule not found.");
  const event = {
    workspaceId: ws,
    gate: "declare" as const,
    decision: "rejected" as const,
    approverId: user.id,
    payloadHash: hashGatePayload({ ruleId }),
    subjectType: "claims_rule",
    subjectId: ruleId,
    reason: String(formData.get("reason") ?? "").trim() || undefined,
  };
  assertCompleteGateEvent(event);
  await insertGateEvent(event);
  revalidatePath(`/p/${ws}/admin/claims`);
}

/**
 * Record a drift finding from an audit. The audit re-runs server-side — the
 * finding records what the server computed, never client-posted conclusions.
 */
export async function recordDriftFindingAction(
  formData: FormData,
): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  await operator(ws, "platina.finding.review");
  const copy = String(formData.get("copy") ?? "").trim();
  if (!copy) refuse(ws, "admin/claims", "Paste the copy to record.");

  const [rules, standard] = await Promise.all([
    listActiveClaimsRules(ws),
    listBrandChunks(ws),
  ]);
  const { dna } = claimsDnaFromRules(rules);
  const audit = await auditCopyAgainstStandard({
    copy,
    standardChunks: standard.map((c) => c.content),
    dna,
  });
  if (audit.drift.state !== "drifted") {
    refuse(
      ws,
      "admin/claims",
      "The audit shows no drift — there is nothing to record.",
    );
  }
  await insertFinding({
    workspaceId: ws,
    useCase: "brand_drift",
    title: `Copy drift: ${copy.slice(0, 60)}${copy.length > 60 ? "…" : ""}`,
    summary: audit.drift.mismatches.map((m) => m.why).join("; "),
    strongestObjection: audit.drift.mismatches[0]?.why ?? null,
    status: "new",
  });
  await broadcastPlatinaSignal(ws, "findings");
  revalidatePath(`/p/${ws}/findings`);
  revalidatePath(`/p/${ws}/admin/claims`);
}

/**
 * Re-audit remediated copy against a drift finding. The audit re-runs
 * server-side; only a clean claims pass AND a clean drift pass closes the
 * finding (superseded — remediation verified by re-audit).
 */
export async function reauditDriftAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const findingId = String(formData.get("findingId") ?? "").trim();
  const copy = String(formData.get("copy") ?? "").trim();
  const user = await operator(ws, "platina.finding.review");
  if (!copy) refuse(ws, "findings", "Paste the remediated copy to re-audit.");

  const finding = await getFinding(ws, findingId);
  if (!finding || finding.status !== "new") {
    refuse(ws, "findings", "Only an open drift finding can be re-audited.");
  }
  const [rules, standard] = await Promise.all([
    listActiveClaimsRules(ws),
    listBrandChunks(ws),
  ]);
  const { dna } = claimsDnaFromRules(rules);
  const audit = await auditCopyAgainstStandard({
    copy,
    standardChunks: standard.map((c) => c.content),
    dna,
  });
  if (audit.claims.verdict !== "passed" || audit.drift.state !== "clean") {
    refuse(
      ws,
      "findings",
      "The re-audit still flags this copy — the finding stays open.",
    );
  }
  await transitionFinding({
    workspaceId: ws,
    findingId,
    from: ["new"],
    to: "superseded",
    ruling: "Remediation verified by re-audit.",
    ruledBy: user.id,
  });
  await broadcastPlatinaSignal(ws, "findings", findingId);
  revalidatePath(`/p/${ws}/findings`);
}

// ---------------------------------------------------------------------------
// Slice 10 — alert rules
// ---------------------------------------------------------------------------

const ALERT_FIELDS: Record<string, string[]> = {
  outcome: [
    "leads",
    "qualifiedLeads",
    "conversionRate",
    "pipelineContribution",
    "qualityScore",
  ],
  finding: ["openDecisions"],
  approval: ["pendingReceipts", "draftSolutions"],
  run: ["failedRuns"],
};

export async function addAlertRuleAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  await operator(ws, "platina.config.manage");
  const name = String(formData.get("name") ?? "").trim();
  const source = String(formData.get("source") ?? "outcome");
  const field = String(formData.get("field") ?? "");
  const op = String(formData.get("op") ?? "");
  const value = Number(formData.get("value"));
  const severity = String(formData.get("severity") ?? "warning");
  if (!name) refuse(ws, "admin", "Rule name is required.");
  if (!isAlertSource(source)) refuse(ws, "admin", "Pick a valid alert source.");
  if (!ALERT_FIELDS[source]?.includes(field)) {
    refuse(ws, "admin", `Pick a metric the ${source} source actually has.`);
  }
  if (!["gt", "lt", "eq", "gte", "lte"].includes(op)) {
    refuse(ws, "admin", "Pick a valid comparison.");
  }
  if (!Number.isFinite(value)) refuse(ws, "admin", "Threshold must be a number.");
  if (!["info", "warning", "critical"].includes(severity)) {
    refuse(ws, "admin", "Pick a valid severity.");
  }
  await insertAlertRule({
    workspaceId: ws,
    name,
    source: source as "outcome" | "finding" | "approval" | "run",
    conditions: [{ field, op: op as "gt" | "lt" | "eq" | "gte" | "lte", value }],
    severity: severity as "info" | "warning" | "critical",
  });
  revalidatePath(`/p/${ws}/admin`);
  revalidatePath(`/p/${ws}`);
}

export async function toggleAlertRuleAction(
  formData: FormData,
): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  await operator(ws, "platina.config.manage");
  const ruleId = String(formData.get("ruleId"));
  const enabled = formData.get("enabled") === "true";
  const updated = await setAlertRuleEnabled(ws, ruleId, enabled);
  if (!updated) refuse(ws, "admin", "Alert rule not found.");
  revalidatePath(`/p/${ws}/admin`);
}
