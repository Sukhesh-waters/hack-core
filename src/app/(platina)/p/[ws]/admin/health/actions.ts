"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import { inngest } from "@/inngest/client";

/** "Run checks now": queues the ops job for this workspace; the board refreshes on the `ops` signal. */
export async function runOpsChecksNowAction(formData: FormData): Promise<void> {
  const ws = String(formData.get("workspaceId") ?? "");
  const here = `/p/${ws}/admin/health`;
  const user = await requireUser();
  await requireMembership(ws, user.id);
  try {
    await inngest.send({ name: "ops/check.requested", data: { workspaceId: ws } });
  } catch {
    redirect(
      `${here}?error=${encodeURIComponent("The background job runner is not running. Start it with npm run dev:all, then try again.")}`,
    );
  }
  redirect(`${here}?running=1`);
}
