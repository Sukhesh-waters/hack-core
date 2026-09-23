"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import {
  approveScanSpec,
  createAuditRun,
  getWorkspaceConfig,
  insertGateEvent,
  insertScanSpec,
  listBrands,
  listScanSpecs,
} from "@/db/queries/platina";
import { inngest } from "@/inngest/client";
import { clampPages } from "@/lib/platina/fetch/actors";
import { assertCompleteGateEvent } from "@/lib/platina/gates";
import { hashGatePayload } from "@/lib/platina/hash";
import { snapshotRunConfig } from "@/lib/platina/orchestrator";
import { classifyUrl, ownerOf } from "@/lib/platina/url-kind";

const WEEKLY = 7 * 24 * 60;
/** First read of a pasted source, as an operator grant (it may pass today's workspace cap). */
const FIRST_READ = { social_posts: 10, ad_library: 10 } as Record<string, number>;

/**
 * "Add any competitor link" (C8.2). Classifies the link, files it under the
 * company that owns it (by its site or LinkedIn page, else the person's
 * choice), makes it an approved weekly source with a recorded confirm gate,
 * and starts the first read now. The client's own pages are refused here:
 * they are first-party and are read by the own-site pass.
 */
export async function addCompetitorUrlAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId") ?? "");
  const raw = String(formData.get("url") ?? "").trim();
  const chosen = String(formData.get("brandId") ?? "");
  const back = (params: Record<string, string>) => redirect(`/p/${ws}/competitors?${new URLSearchParams(params)}`);

  const user = await requireUser();
  await requireMembership(ws, user.id);

  const kind = classifyUrl(raw);
  if (!kind.ok) back({ error: kind.reason, add: raw });
  if (!kind.ok) return;

  const brands = await listBrands(ws);
  const byLink = ownerOf(
    kind,
    brands.map((b) => ({ id: b.id, name: b.name, kind: b.kind, homepageUrl: b.homepageUrl ?? null, handles: b.handles })),
  );
  if (byLink?.kind === "own_brand") {
    back({
      error: `That is ${byLink.name}'s own page. Own pages are first-party: they are read by the own-site pass (Clients -> ${byLink.name}), never tracked as public data.`,
    });
  }

  const specs = await listScanSpecs(ws);
  const existing = specs.find((s) => s.targets.some((t) => t.value === kind.value));
  const brandId =
    existing?.brandId ?? byLink?.id ?? (chosen && brands.some((b) => b.id === chosen && b.kind === "competitor") ? chosen : null);
  if (!existing && !brandId && kind.kind !== "conference" && chosen !== "market") {
    back({ error: "Which company is this about? Pick it in the list (or 'Market' for a general page).", add: raw });
  }

  let specId = existing?.id ?? null;
  if (!specId) {
    const owner = brands.find((b) => b.id === brandId);
    specId = await insertScanSpec({
      workspaceId: ws,
      name: `${owner?.name ?? "Market"} · ${kind.label.toLowerCase()}`,
      targets: [{ kind: kind.kind, value: kind.value, maxPages: FIRST_READ[kind.kind] ?? 1 }],
      cadenceMinutes: WEEKLY,
      createdById: user.id,
      brandId,
    });
    await approveScanSpec(ws, specId);
    const gate = {
      workspaceId: ws,
      gate: "confirm" as const,
      decision: "approved" as const,
      approverId: user.id,
      payloadHash: hashGatePayload({ specId, url: kind.value }),
      subjectType: "scan_spec",
      subjectId: specId,
    };
    assertCompleteGateEvent(gate);
    await insertGateEvent(gate);
  }

  const config = await getWorkspaceConfig(ws);
  const runId = await createAuditRun({
    workspaceId: ws,
    specId,
    trigger: "manual",
    idempotencyKey: `add:${specId}:${Date.now()}`,
    configSnapshot: { ...snapshotRunConfig(config), seedPages: clampPages(FIRST_READ[kind.kind] ?? 1) },
  });
  if (!runId) back({ error: "Could not start the read; try again." });
  try {
    await inngest.send({ name: "platina/audit-run.requested", data: { runId, workspaceId: ws } });
  } catch {
    back({ error: "The background job runner is not running. Start it with npm run dev:all, then add the link again." });
  }
  back({ run: runId!, added: kind.label });
}
