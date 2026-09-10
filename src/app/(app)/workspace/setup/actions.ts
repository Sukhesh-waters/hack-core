"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { memberships, orgs, workspaces } from "@/db/schema";
import { actionErrorMessage } from "@/lib/action-errors";
import { workspaceSetupSchema } from "@/lib/validation";

export type SetupWorkspaceState = { error?: string } | undefined;

export async function setupWorkspace(
  _prev: SetupWorkspaceState,
  formData: FormData,
): Promise<SetupWorkspaceState> {
  const parsed = workspaceSetupSchema.safeParse({
    orgId: formData.get("orgId"),
    name: formData.get("name"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  let workspaceId: string;
  try {
    const user = await requireUser();

    const [org] = await db
      .select()
      .from(orgs)
      .where(eq(orgs.id, parsed.data.orgId))
      .limit(1);
    if (!org) return { error: "Organization not found." };
    if (org.ownerUserId !== user.id) {
      return { error: "Only the org owner can create workspaces." };
    }

    const taken = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, parsed.data.slug))
      .limit(1);
    if (taken.length > 0) {
      return { error: "That slug is already taken — try another." };
    }

    // Workspace + owner membership land together or not at all.
    workspaceId = await db.transaction(async (tx) => {
      const [workspace] = await tx
        .insert(workspaces)
        .values({
          orgId: org.id,
          name: parsed.data.name,
          slug: parsed.data.slug,
        })
        .returning({ id: workspaces.id });
      await tx.insert(memberships).values({
        workspaceId: workspace.id,
        userId: user.id,
        role: "owner",
      });
      return workspace.id;
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  redirect(`/workspace/ready?ws=${workspaceId}`);
}
