"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { REVIEW_FACTORS, REVIEW_VERDICTS, type ReviewWhy } from "@/db/platina-schema";
import { requireCapability } from "@/db/queries/memberships";
import { getBrand, getPlan } from "@/db/queries/platina";
import {
  getCreative,
  getReviewForCreative,
  insertCreative,
  listCreatives,
  upsertMetricSnapshots,
  type MetricInput,
} from "@/db/queries/platina-learning";
import { inngest } from "@/inngest/client";
import { confirmReview, draftReview } from "@/lib/platina/learning-service";
import { parseCount, parseMetricsSheet, parseSheetDate, refKey } from "@/lib/platina/metrics-import";
import { broadcastPlatinaSignal } from "@/lib/platina/realtime-server";

const CAPABILITY = "platina.outcome.import";

function refuse(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
}

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const optional = (f: FormData, k: string) => text(f, k) || null;

async function signalResults(ws: string, brandId: string | null, id?: string) {
  await broadcastPlatinaSignal(ws, "results", id);
  // Opens any review that is now due; a down job runner only delays it.
  await inngest.send({ name: "platina/results.updated", data: { workspaceId: ws, brandId } }).catch(() => undefined);
}

export async function addCreativeAction(formData: FormData): Promise<void> {
  const ws = text(formData, "workspaceId");
  const back = `/p/${ws}/results/new?${new URLSearchParams(
    ["brand", "plan", "phase", "opp", "topic"].flatMap((k) => (formData.get(k) ? [[k, text(formData, k)]] : [])),
  )}`;
  const user = await requireUser();
  await requireCapability(ws, user.id, CAPABILITY);

  const title = text(formData, "title");
  const channel = text(formData, "channel").toLowerCase();
  const format = text(formData, "format").toLowerCase();
  const hypothesis = text(formData, "hypothesis");
  if (title.length < 3) refuse(back, "Give the creative a title.");
  if (!channel) refuse(back, "Which channel was it posted on?");
  if (!format) refuse(back, "Which format is it?");
  if (hypothesis.length < 10) refuse(back, "Write one line on what you expect and why: results are read against it.");

  const brandId = optional(formData, "brand");
  if (brandId && !(await getBrand(ws, brandId))) refuse(back, "That client is not in this workspace.");
  const planId = optional(formData, "plan");
  const phaseId = optional(formData, "phase");
  if (planId) {
    const plan = await getPlan(ws, planId);
    if (!plan) refuse(back, "That plan is not in this workspace.");
    if (phaseId && !plan.plan.phases.some((p) => p.id === phaseId)) refuse(back, "That phase is not in the plan.");
  }
  const url = optional(formData, "url");
  if (url && !/^https?:\/\//i.test(url)) refuse(back, "The link should start with http:// or https://");
  const postedRaw = text(formData, "postedAt");
  const postedAt = postedRaw ? parseSheetDate(postedRaw) : null;
  if (postedRaw && !postedAt) refuse(back, "The posting date doesn't look right.");

  const id = await insertCreative(ws, user.id, {
    brandId,
    planId,
    phaseId,
    opportunityKey: optional(formData, "opp"),
    title,
    channel,
    format,
    topic: optional(formData, "topic"),
    hookType: optional(formData, "hookType")?.toLowerCase() ?? null,
    cta: optional(formData, "cta"),
    url,
    externalId: optional(formData, "externalId"),
    hypothesis,
    postedAt,
    status: postedAt ? "live" : "draft",
  });
  await broadcastPlatinaSignal(ws, "results", id);
  revalidatePath(`/p/${ws}/results`);
  redirect(`/p/${ws}/results/${id}?added=1`);
}

const NUMBER_FIELDS = ["impressions", "reach", "clicks", "engagements", "saves", "shares", "videoViews", "leads", "spend"] as const;

export async function addNumbersAction(formData: FormData): Promise<void> {
  const ws = text(formData, "workspaceId");
  const creativeId = text(formData, "creativeId");
  const here = `/p/${ws}/results/${creativeId}`;
  const user = await requireUser();
  await requireCapability(ws, user.id, CAPABILITY);
  const creative = await getCreative(ws, creativeId);
  if (!creative) refuse(`/p/${ws}/results`, "Creative not found.");

  const dateRaw = text(formData, "capturedAt");
  const capturedAt = dateRaw ? parseSheetDate(dateRaw) : new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  if (!capturedAt) refuse(here, "The date doesn't look right (use the date picker).");
  const values: Record<string, number | null> = {};
  for (const field of NUMBER_FIELDS) {
    const n = parseCount(text(formData, field));
    if (Number.isNaN(n)) refuse(here, `"${text(formData, field)}" is not a number (${field}).`);
    values[field] = n;
  }
  if (NUMBER_FIELDS.every((f) => values[f] === null)) refuse(here, "Enter at least one number.");

  await upsertMetricSnapshots(ws, user.id, [
    { creativeId, capturedAt, source: "manual", ...(values as Omit<MetricInput, "creativeId" | "capturedAt" | "source">) },
  ]);
  await signalResults(ws, creative.brandId, creativeId);
  revalidatePath(here);
  revalidatePath(`/p/${ws}/results`);
  redirect(`${here}?saved=1`);
}

/** A pasted sheet (Platina layout or LinkedIn's page analytics export). */
export async function importNumbersAction(formData: FormData): Promise<void> {
  const ws = text(formData, "workspaceId");
  const back = `/p/${ws}/results`;
  const user = await requireUser();
  await requireCapability(ws, user.id, CAPABILITY);

  const parsed = parseMetricsSheet(String(formData.get("sheet") ?? ""), new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z"));
  if (parsed.errors.length > 0) refuse(back, `Nothing was imported. ${parsed.errors.slice(0, 5).join("; ")}`);

  const creatives = await listCreatives(ws);
  const byRef = new Map<string, string>();
  for (const c of creatives) {
    byRef.set(c.id, c.id);
    if (c.url) byRef.set(refKey(c.url), c.id);
    if (c.externalId) byRef.set(refKey(c.externalId), c.id);
  }
  const unknown = parsed.rows.filter((r) => !byRef.has(r.ref) && !byRef.has(refKey(r.ref)));
  if (unknown.length > 0) {
    refuse(
      back,
      `Nothing was imported: ${unknown.length} row(s) match no creative (${unknown
        .slice(0, 3)
        .map((r) => r.ref)
        .join(", ")}). Add those creatives first, with the same post link.`,
    );
  }
  const source = parsed.layout === "linkedin" ? "csv:linkedin" : "csv";
  const rows: MetricInput[] = parsed.rows.map(({ ref, ...r }) => ({
    ...r,
    creativeId: byRef.get(ref) ?? byRef.get(refKey(ref))!,
    source,
  }));
  const written = await upsertMetricSnapshots(ws, user.id, rows);
  await signalResults(ws, null);
  revalidatePath(back);
  redirect(`${back}?imported=${written}`);
}

/** Opens (or redoes) the drafted review now, without waiting for the daily job. */
export async function draftReviewAction(formData: FormData): Promise<void> {
  const ws = text(formData, "workspaceId");
  const creativeId = text(formData, "creativeId");
  const here = `/p/${ws}/results/${creativeId}`;
  const user = await requireUser();
  await requireCapability(ws, user.id, CAPABILITY);
  const result = await draftReview(ws, creativeId);
  if (result === "skipped") refuse(here, "This review is already confirmed.");
  revalidatePath(here);
  redirect(`${here}#review`);
}

export async function confirmReviewAction(formData: FormData): Promise<void> {
  const ws = text(formData, "workspaceId");
  const creativeId = text(formData, "creativeId");
  const here = `/p/${ws}/results/${creativeId}`;
  const user = await requireUser();
  await requireCapability(ws, user.id, CAPABILITY);

  const review = await getReviewForCreative(ws, creativeId);
  if (!review) refuse(here, "Open the review first.");
  if (review.status === "confirmed") refuse(here, "This review is already confirmed.");

  const verdict = REVIEW_VERDICTS.find((v) => v === text(formData, "verdict"));
  if (!verdict) refuse(`${here}#review`, "Choose whether it worked, was mixed, or failed.");
  const what = text(formData, "what");
  const how = text(formData, "how");
  if (what.length < 5) refuse(`${here}#review`, "Say what happened.");
  if (how.length < 5) refuse(`${here}#review`, "Say what to change next time.");

  const why: ReviewWhy[] = [];
  for (let i = 0; i < 6; i += 1) {
    const factor = REVIEW_FACTORS.find((f) => f === text(formData, `factor_${i}`));
    const effect = (["helped", "hurt", "neutral"] as const).find((e) => e === text(formData, `effect_${i}`));
    const reason = text(formData, `reason_${i}`);
    if (factor && effect && reason) why.push({ factor, effect, reason });
  }
  const keep = optional(formData, "keep");
  const edited =
    verdict !== review.verdict ||
    what !== (review.what ?? "") ||
    how !== (review.how ?? "") ||
    (keep ?? "") !== (review.keep ?? "") ||
    JSON.stringify(why) !== JSON.stringify(review.why);

  const result = await confirmReview(ws, {
    reviewId: review.id,
    creativeId,
    verdict,
    what,
    why,
    how,
    keep,
    backtrackIds: formData.getAll("backtrack").map(String),
    edited,
    userId: user.id,
  });
  if (!result.confirmed) refuse(here, "This review changed while you were editing it; reload and try again.");
  revalidatePath(here);
  revalidatePath(`/p/${ws}/results`);
  revalidatePath(`/p/${ws}/opportunities`);
  redirect(`${here}?confirmed=1&demoted=${result.demoted}&promoted=${result.promoted}`);
}
