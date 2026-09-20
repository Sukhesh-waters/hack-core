"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { PLAN_VERDICTS } from "@/db/platina-schema";
import { requireMembership } from "@/db/queries/memberships";
import { upsertPlanFeedback } from "@/db/queries/platina";
import { actionErrorMessage } from "@/lib/action-errors";
import { runWithAiCost } from "@/lib/ai/usage-context";
import { briefSchema } from "@/lib/platina/plan/brief";
import { runPlanFlow } from "@/lib/platina/plan/flow";

function back(ws: string, path: string, error: string): never {
  redirect(`/p/${ws}/${path}?error=${encodeURIComponent(error)}`);
}

/** Two-line brief -> planned, reviewed, saved roadmap. Errors ride `?error=`. */
export async function createPlanAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId") ?? "");
  const parsed = briefSchema.safeParse(String(formData.get("brief") ?? ""));
  if (!parsed.success) back(ws, "plan", parsed.error.issues[0].message);

  let planId: string;
  try {
    const user = await requireUser();
    await requireMembership(ws, user.id);
    const result = await runWithAiCost(
      { workspaceId: ws, purpose: "campaign-plan" },
      () =>
        runPlanFlow({
          workspaceId: ws,
          brief: parsed.data as string,
          userId: user.id,
        }),
    );
    if (result.status === "invalid_proposal") {
      back(
        ws,
        "plan",
        `The planner produced an unusable plan (${result.reason}). Try again.`,
      );
    }
    if (result.status !== "completed") {
      back(ws, "plan", "Not enough context to plan yet.");
    }
    planId = result.output.planId;
  } catch (error) {
    // redirect() throws a control-flow error; let it through untouched.
    if (isRedirect(error)) throw error;
    back(ws, "plan", actionErrorMessage(error));
  }

  revalidatePath(`/p/${ws}/plan`);
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
