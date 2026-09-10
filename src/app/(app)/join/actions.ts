"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { memberships } from "@/db/schema";
import { getMembership } from "@/db/queries/memberships";
import { findWorkspaceByCode } from "@/db/queries/workspaces";
import { actionErrorMessage } from "@/lib/action-errors";
import { joinWorkspaceSchema } from "@/lib/validation";

export type JoinWorkspaceState = { error?: string } | undefined;

export async function joinWorkspace(
  _prev: JoinWorkspaceState,
  formData: FormData,
): Promise<JoinWorkspaceState> {
  const parsed = joinWorkspaceSchema.safeParse({
    code: formData.get("code"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  let workspaceId: string;
  try {
    const user = await requireUser();

    const workspace = await findWorkspaceByCode(parsed.data.code);
    if (!workspace) {
      return { error: "No workspace matches that code." };
    }

    const existing = await getMembership(workspace.id, user.id);
    if (!existing) {
      await db.insert(memberships).values({
        workspaceId: workspace.id,
        userId: user.id,
        role: "member",
      });
    }
    workspaceId = workspace.id;
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  redirect(`/workspace/ready?ws=${workspaceId}`);
}
