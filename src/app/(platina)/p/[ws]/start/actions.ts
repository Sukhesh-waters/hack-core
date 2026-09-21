"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { requireCapability } from "@/db/queries/memberships";
import {
  approveScanSpec,
  createAuditRun,
  createBrand,
  getBrand,
  getWorkspaceConfig,
  insertGateEvent,
  insertScanSpec,
} from "@/db/queries/platina";
import { inngest } from "@/inngest/client";
import { snapshotRunConfig } from "@/lib/platina/orchestrator";
import { GATE_CAPABILITY, assertCompleteGateEvent } from "@/lib/platina/gates";
import { hashGatePayload } from "@/lib/platina/hash";
import {
  DEFAULT_CADENCE_MINUTES,
  candidatesToSpecs,
  deriveSources,
  normalizeHandle,
  normalizeHomepage,
  type SpecDraft,
} from "@/lib/platina/onboard/derive";
import { MAX_COMPETITOR_PROPOSALS } from "@/lib/platina/onboard/competitors";
import { candidateFromId } from "@/lib/platina/onboard/sitemap";

/** A rejected submission comes back as a message on the page. */
function refuse(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

/** Drizzle wraps driver errors; the Postgres code may sit on the cause. */
function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export async function createClientAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const start = `/p/${ws}/start`;
  const user = await requireUser();
  await requireCapability(ws, user.id, "platina.audit.manage");

  const name = String(formData.get("name") ?? "").trim();
  const homepageRaw = String(formData.get("homepageUrl") ?? "").trim();
  const homepageUrl = homepageRaw ? normalizeHomepage(homepageRaw) : null;
  const instagram = normalizeHandle(String(formData.get("instagram") ?? ""));
  const tiktok = normalizeHandle(String(formData.get("tiktok") ?? ""));
  const region = String(formData.get("region") ?? "").trim() || null;

  if (name.length < 2) refuse(start, "Enter the client's name.");
  if (homepageRaw && !homepageUrl) refuse(start, "That website address doesn't look right.");
  if (!homepageUrl && !instagram && !tiktok) {
    refuse(start, "Add a website or at least one social handle so there is something to watch.");
  }

  let brandId: string;
  try {
    brandId = await createBrand({
      workspaceId: ws,
      name,
      kind: "own_brand",
      homepageUrl,
      handles: {
        ...(instagram ? { instagram } : {}),
        ...(tiktok ? { tiktok } : {}),
      },
      region,
      createdById: user.id,
    });
  } catch (error) {
    if (isUniqueViolation(error)) refuse(start, "A client with that name already exists.");
    throw error;
  }
  revalidatePath(`/p/${ws}`);
  redirect(`/p/${ws}/start/${brandId}`);
}

type CompetitorRow = { name: string; homepageUrl: string };

/** Pairs the parallel form fields; blank, unticked and unusable rows are dropped. */
function readCompetitors(formData: FormData): CompetitorRow[] {
  const names = formData.getAll("compName").map(String);
  const urls = formData.getAll("compUrl").map(String);
  const on = new Set(formData.getAll("compOn").map(String));
  const seen = new Set<string>();
  const rows: CompetitorRow[] = [];
  names.forEach((rawName, i) => {
    const name = rawName.trim();
    const homepageUrl = normalizeHomepage(urls[i] ?? "");
    if (!on.has(String(i)) || name.length < 2 || !homepageUrl) return;
    if (seen.has(homepageUrl)) return;
    seen.add(homepageUrl);
    rows.push({ name, homepageUrl });
  });
  return rows.slice(0, MAX_COMPETITOR_PROPOSALS);
}

/**
 * The one approval. Records a single "confirm" gate decision for the whole
 * set, then creates and approves a scan spec per source. A failure midway
 * leaves the rest as drafts — harmless, because a draft can never be fetched —
 * and the count of what did start is reported back.
 */
export async function approveClientSourcesAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId"));
  const brandId = String(formData.get("brandId"));
  const here = `/p/${ws}/start/${brandId}`;
  const user = await requireUser();
  await requireCapability(ws, user.id, GATE_CAPABILITY.confirm);

  const brand = await getBrand(ws, brandId);
  if (!brand || brand.kind !== "own_brand") refuse(`/p/${ws}/start`, "Client not found.");

  // Candidates are re-derived here from the stored brand (derivation is
  // deterministic), so the form can only pick from that list — never inject a URL.
  const candidates = deriveSources({
    homepageUrl: brand.homepageUrl ?? "",
    handles: brand.handles,
  });
  const picked = new Set(formData.getAll("source").map(String));
  // Sections found in the site's sitemap are not derivable from the brand
  // alone; they are re-validated (client's own origin, one segment deep) rather
  // than trusted as submitted.
  const origin = normalizeHomepage(brand.homepageUrl ?? "");
  const derivedIds = new Set(candidates.map((c) => c.id));
  const extras = origin
    ? [...picked]
        .filter((id) => !derivedIds.has(id))
        .flatMap((id) => {
          const c = candidateFromId(id, origin);
          return c ? [c] : [];
        })
    : [];
  const approved = [...candidates.filter((c) => picked.has(c.id)), ...extras];
  const competitors = readCompetitors(formData);
  if (approved.length === 0 && competitors.length === 0) {
    refuse(here, "Tick at least one source to watch.");
  }

  const drafts: { brandId: string; spec: SpecDraft }[] = candidatesToSpecs(
    brand.name,
    approved,
    formData.get("sitemap") === "1",
  ).map((spec) => ({ brandId: brand.id, spec }));

  const failures: string[] = [];
  for (const c of competitors) {
    try {
      const competitorId = await createBrand({
        workspaceId: ws,
        name: c.name,
        kind: "competitor",
        parentBrandId: brand.id,
        homepageUrl: c.homepageUrl,
        createdById: user.id,
      });
      drafts.push({
        brandId: competitorId,
        spec: {
          name: `${c.name} · website`,
          cadenceMinutes: DEFAULT_CADENCE_MINUTES,
          targets: [{ kind: "competitor_site", value: c.homepageUrl, maxPages: 3 }],
        },
      });
    } catch (error) {
      failures.push(
        isUniqueViolation(error)
          ? `${c.name} is already tracked`
          : `${c.name} could not be added`,
      );
    }
  }

  const event = {
    workspaceId: ws,
    gate: "confirm" as const,
    decision: "approved" as const,
    approverId: user.id,
    payloadHash: hashGatePayload({
      brandId,
      sources: approved.map((c) => c.id),
      competitors: competitors.map((c) => c.homepageUrl),
    }),
    subjectType: "brand",
    subjectId: brand.id,
  };
  assertCompleteGateEvent(event);
  await insertGateEvent(event);

  let started = 0;
  // Approved sources, with the order the first pass should run in: the client's
  // homepage first (it drives the client profile), then its other pages, then
  // competitors.
  const startedSpecs: { id: string; priority: number }[] = [];
  for (const { brandId: owner, spec } of drafts) {
    try {
      const specId = await insertScanSpec({
        workspaceId: ws,
        name: spec.name,
        targets: spec.targets,
        cadenceMinutes: spec.cadenceMinutes,
        createdById: user.id,
        brandId: owner,
      });
      await approveScanSpec(ws, specId);
      started += 1;
      const target = spec.targets[0];
      let homepage = false;
      try {
        homepage = target.kind === "competitor_site" && new URL(target.value).pathname === "/";
      } catch {
        // an unparsable value simply is not a homepage
      }
      startedSpecs.push({ id: specId, priority: owner === brand.id ? (homepage ? 0 : 1) : 2 });
    } catch {
      failures.push(`${spec.name} could not be started`);
    }
  }

  // First pass NOW — waiting for the next scheduler tick made a pasted URL look
  // like nothing happened. Runs are recorded first, so if the job runner is not
  // up the runs stay queued (visible) and are re-sent as soon as it starts.
  let jobsDown = false;
  if (startedSpecs.length > 0) {
    const config = await getWorkspaceConfig(ws);
    const runs: { runId: string }[] = [];
    for (const s of startedSpecs.sort((a, b) => a.priority - b.priority)) {
      const runId = await createAuditRun({
        workspaceId: ws,
        specId: s.id,
        trigger: "event",
        idempotencyKey: `first-pass:${s.id}`,
        configSnapshot: snapshotRunConfig(config),
      });
      if (runId) runs.push({ runId });
    }
    try {
      await inngest.send(
        runs.map((r) => ({
          name: "platina/audit-run.requested",
          data: { runId: r.runId, workspaceId: ws },
        })),
      );
    } catch {
      jobsDown = true;
    }
  }

  revalidatePath(`/p/${ws}`);
  revalidatePath(`/p/${ws}/brands`);
  if (jobsDown) {
    failures.push(
      "The background job runner is not running, so nothing will be collected yet. Start it with npm run dev:all (or npm run dev:jobs in a second terminal); the first pass begins by itself once it is up",
    );
  }
  const notice =
    failures.length > 0
      ? `Started ${started} of ${drafts.length}. ${failures.join("; ")}.`
      : "";
  redirect(
    `/p/${ws}/brands/${brand.id}${notice ? `?error=${encodeURIComponent(notice)}` : "?started=1"}`,
  );
}
