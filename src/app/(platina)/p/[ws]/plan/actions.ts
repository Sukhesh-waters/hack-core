"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { PLAN_VERDICTS } from "@/db/platina-schema";
import { requireMembership } from "@/db/queries/memberships";
import {
  getBrand,
  getClientForFinding,
  getFinding,
  getPlan,
  upsertPlanFeedback,
} from "@/db/queries/platina";
import { actionErrorMessage } from "@/lib/action-errors";
import { runWithAiCost } from "@/lib/ai/usage-context";
import { briefSchema } from "@/lib/platina/plan/brief";
import { runPlanFlow } from "@/lib/platina/plan/flow";
import {
  briefFromClient,
  briefFromEvent,
  briefFromFinding,
  remainingAnchor,
  UseCaseError,
  type PlanRequest,
} from "@/lib/platina/plan/usecases";

function back(ws: string, path: string, error: string): never {
  redirect(`/p/${ws}/${path}?error=${encodeURIComponent(error)}`);
}

/** A client the form named, verified to be an own brand in THIS workspace. */
async function clientOf(ws: string, id: FormDataEntryValue | null) {
  const brandId = String(id ?? "").trim();
  if (!brandId) return null;
  const brand = await getBrand(ws, brandId);
  return brand && brand.kind === "own_brand" ? brand : null;
}

/**
 * Turns whichever situation the user started from into one PlanRequest.
 * Every id from the form is re-read inside the workspace — a forged finding or
 * client id from another tenant resolves to nothing.
 */
async function requestFromForm(
  ws: string,
  formData: FormData,
): Promise<{ request: PlanRequest; brandId: string | null }> {
  const useCase = String(formData.get("useCase") ?? "brief");

  if (useCase === "finding") {
    const finding = await getFinding(ws, String(formData.get("findingId") ?? ""));
    if (!finding) throw new UseCaseError("That finding could not be found.");
    const client = await getClientForFinding(ws, finding.id);
    return {
      request: briefFromFinding({
        findingId: finding.id,
        title: finding.title,
        summary: finding.summary,
        clientName: client?.name,
      }),
      brandId: client?.id ?? null,
    };
  }

  if (useCase === "event") {
    const client = await clientOf(ws, formData.get("brandId"));
    return {
      request: briefFromEvent({
        name: String(formData.get("eventName") ?? ""),
        date: String(formData.get("eventDate") ?? ""),
        now: new Date(),
        clientName: client?.name,
      }),
      brandId: client?.id ?? null,
    };
  }

  if (useCase === "client") {
    const client = await clientOf(ws, formData.get("brandId"));
    if (!client) throw new UseCaseError("Pick the client this campaign is for.");
    return {
      request: briefFromClient({
        clientName: client.name,
        goal: String(formData.get("goal") ?? ""),
      }),
      brandId: client.id,
    };
  }

  const parsed = briefSchema.safeParse(String(formData.get("brief") ?? ""));
  if (!parsed.success) throw new UseCaseError(parsed.error.issues[0].message);
  const client = await clientOf(ws, formData.get("brandId"));
  return {
    request: {
      brief: parsed.data,
      origin: { kind: "brief", label: client ? `Brief for ${client.name}` : "Your brief" },
    },
    brandId: client?.id ?? null,
  };
}

/** A situation (or a two-line brief) -> planned, reviewed, saved roadmap. Errors ride `?error=`. */
export async function createPlanAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId") ?? "");

  let planId: string;
  try {
    const user = await requireUser();
    await requireMembership(ws, user.id);
    const { request, brandId } = await requestFromForm(ws, formData);
    // The generated brief must still satisfy the same two-line contract.
    const checked = briefSchema.safeParse(request.brief);
    if (!checked.success) back(ws, "plan", checked.error.issues[0].message);

    const result = await runWithAiCost(
      { workspaceId: ws, purpose: "campaign-plan" },
      () =>
        runPlanFlow({
          workspaceId: ws,
          brief: checked.data,
          userId: user.id,
          brandId,
          origin: request.origin,
          anchor:
            request.anchorDay === undefined
              ? null
              : { label: request.origin.label, day: request.anchorDay },
        }),
    );
    if (result.status === "invalid_proposal") {
      back(ws, "plan", `The planner produced an unusable plan (${result.reason}). Try again.`);
    }
    if (result.status !== "completed") {
      back(ws, "plan", "Not enough context to plan yet.");
    }
    planId = result.output.planId;
  } catch (error) {
    // redirect() throws a control-flow error; let it through untouched.
    if (isRedirect(error)) throw error;
    if (error instanceof UseCaseError) back(ws, "plan", error.message);
    back(ws, "plan", actionErrorMessage(error));
  }

  revalidatePath(`/p/${ws}/plan`);
  revalidatePath(`/p/${ws}`);
  redirect(`/p/${ws}/plan/${planId}`);
}

/**
 * Re-plans an existing plan against everything collected since — one click.
 * The new plan links back to the one it revises and says what changed; the
 * old plan is kept untouched (history, and its recorded result, stay intact).
 */
export async function revisePlanAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId") ?? "");
  const parentId = String(formData.get("planId") ?? "");

  let planId: string;
  try {
    const user = await requireUser();
    await requireMembership(ws, user.id);
    const parent = await getPlan(ws, parentId);
    if (!parent) back(ws, "plan", "That plan could not be found.");

    const now = new Date();
    const left = remainingAnchor(parent.origin, parent.createdAt, now);
    if (left === null) {
      back(ws, `plan/${parentId}`, "The date this plan was built for has passed, so it can't be revised toward it. Start a new plan instead.");
    }
    const anchor =
      left === undefined ? null : { label: parent.origin?.label ?? "the fixed date", day: left };

    const result = await runWithAiCost(
      { workspaceId: ws, purpose: "campaign-plan-revision" },
      () =>
        runPlanFlow({
          workspaceId: ws,
          brief: parent.brief,
          userId: user.id,
          brandId: parent.brandId,
          origin: {
            kind: "revision",
            refId: parent.id,
            label: `Revised: ${parent.title}`,
            ...(anchor ? { anchorDay: anchor.day } : {}),
          },
          anchor,
          revision: {
            planId: parent.id,
            title: parent.title,
            summary: parent.plan.summary,
            phases: parent.plan.phases.map(
              (p) => `Days ${p.startDay}-${p.endDay} · ${p.channel} · ${p.name}`,
            ),
            createdAt: parent.createdAt,
          },
        }),
    );
    if (result.status === "invalid_proposal") {
      back(ws, `plan/${parentId}`, `The revised plan was unusable (${result.reason}). Try again.`);
    }
    if (result.status !== "completed") {
      back(ws, `plan/${parentId}`, "Not enough context to re-plan yet.");
    }
    planId = result.output.planId;
  } catch (error) {
    if (isRedirect(error)) throw error;
    back(ws, `plan/${parentId}`, actionErrorMessage(error));
  }

  revalidatePath(`/p/${ws}/plan`);
  revalidatePath(`/p/${ws}`);
  redirect(`/p/${ws}/plan/${planId}`);
}

/** Record how a plan went; it becomes a lesson for the next one. */
export async function recordPlanFeedbackAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId") ?? "");
  const planId = String(formData.get("planId") ?? "");
  const verdict = String(formData.get("verdict") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);

  if (!(PLAN_VERDICTS as readonly string[]).includes(verdict)) {
    back(ws, `plan/${planId}`, "Pick how it went: worked, mixed or failed.");
  }

  try {
    const user = await requireUser();
    await requireMembership(ws, user.id);
    await upsertPlanFeedback({
      workspaceId: ws,
      planId,
      verdict: verdict as (typeof PLAN_VERDICTS)[number],
      note: note || null,
      createdById: user.id,
    });
  } catch (error) {
    if (isRedirect(error)) throw error;
    back(ws, `plan/${planId}`, actionErrorMessage(error));
  }

  revalidatePath(`/p/${ws}/plan`);
  redirect(`/p/${ws}/plan/${planId}?saved=1`);
}

function isRedirect(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}
