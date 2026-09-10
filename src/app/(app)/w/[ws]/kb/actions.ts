"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import {
  getHarnessRule,
  listTopPatternPosts,
  upsertHarnessRule,
} from "@/db/queries/harness";
import { createInsights } from "@/db/queries/insights";
import { inngest } from "@/inngest/client";
import { actionErrorMessage } from "@/lib/action-errors";
import {
  generatePatternInsights,
  type PatternObservation,
} from "@/lib/ai/pattern-insight-agent";
import { runWithAiCost } from "@/lib/ai/usage-context";
import { harnessRuleSchema } from "@/lib/validation";

export type HarnessActionState = { error?: string; ok?: string } | undefined;

export async function saveHarnessRule(
  _prev: HarnessActionState,
  formData: FormData,
): Promise<HarnessActionState> {
  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { error: "Malformed harness payload — reload and try again." };
  }
  const parsed = harnessRuleSchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, ...patch } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    await upsertHarnessRule(workspaceId, patch);
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
  revalidatePath(`/w/${workspaceId}/kb`);
  return { ok: "Harness rules saved." };
}

/** Manual "Run now": fires the Inngest event; the function does the work. */
export async function requestPatternRun(
  _prev: HarnessActionState,
  formData: FormData,
): Promise<HarnessActionState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    const rule = await getHarnessRule(workspaceId);
    if (!rule || rule.segments.length === 0) {
      return { error: "Add at least one segment before running a scan." };
    }
    await inngest.send({
      name: "patterns/run.requested",
      data: { workspaceId },
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
  revalidatePath(`/w/${workspaceId}/kb`);
  return { ok: "Scan queued — results land in the pattern layer shortly." };
}

export type InsightBriefState =
  | { error?: string; observations?: PatternObservation[] }
  | undefined;

/** Insight brief: top pattern posts only — never baseline rows (two-layer). */
export async function generateInsightBrief(
  _prev: InsightBriefState,
  formData: FormData,
): Promise<InsightBriefState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    const top = await listTopPatternPosts(workspaceId, 12);
    if (top.length === 0) {
      return { error: "No pattern posts yet — run a scan first." };
    }
    const observations = await runWithAiCost(
      { workspaceId, purpose: "pattern-insight" },
      () =>
        generatePatternInsights(
          top.map((p) => ({
            id: p.id,
            pageHandle: p.pageHandle,
            segment: p.segment,
            caption: p.caption,
            format: p.format,
            likes: p.likes,
            comments: p.comments,
          })),
        ),
    );

    // G3 — persist so re-opening the page doesn't pay routeAI again for the
    // same observations. A persist failure must not lose what the user just
    // saw generate — degradation ladder (I5): log and still return them.
    try {
      await createInsights({
        workspaceId,
        observations: observations.map((o) => ({
          pattern: o.pattern,
          suggestion: o.suggestion,
          evidence: o.evidence,
        })),
      });
    } catch (persistError) {
      console.error("Failed to persist insights:", persistError);
    }

    return { observations };
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
}
