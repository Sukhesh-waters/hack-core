"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { requireMembership } from "@/db/queries/memberships";
import {
  createWorkspaceDoc,
  getWorkspaceDocBySlug,
  updateWorkspaceDoc,
} from "@/db/queries/workspace-docs";
import { actionErrorMessage } from "@/lib/action-errors";
import { createWorkspaceDocSchema, updateWorkspaceDocSchema } from "@/lib/docs";
import { slugify } from "@/lib/validation";

export type DocState = { error?: string; slug?: string } | undefined;

/**
 * Slug-collision handling: action-layer pre-check via getWorkspaceDocBySlug
 * (same precedent as claimOrg's slug pre-check in
 * src/app/(app)/org/claim/actions.ts), then a numeric suffix fallback
 * (title-2, title-3, ...) rather than a hard error — a doc creation should
 * not usually block a teammate on manually renaming, and titles collide
 * often ("Onboarding", "Onboarding"). Bounded to 50 attempts so a pathological
 * loop can't hang the request; the DB's unique index is the last-line
 * backstop regardless.
 */
async function uniqueSlugForCreate(workspaceId: string, title: string) {
  const base = slugify(title) || "doc";
  let candidate = base;
  for (let attempt = 2; attempt <= 51; attempt++) {
    const existing = await getWorkspaceDocBySlug(workspaceId, candidate);
    if (!existing) return candidate;
    candidate = `${base}-${attempt}`;
  }
  throw new Error("Could not generate a unique slug for this title.");
}

export async function createWorkspaceDocAction(
  _prev: DocState,
  formData: FormData,
): Promise<DocState> {
  const parsed = createWorkspaceDocSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    title: formData.get("title"),
    body: formData.get("body"),
    kind: formData.get("kind") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, title, body, kind } = parsed.data;

  let slug: string;
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    slug = await uniqueSlugForCreate(workspaceId, title);
    await createWorkspaceDoc({
      workspaceId,
      slug,
      title,
      body,
      kind,
      createdById: user.id,
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/docs`);
  return { slug };
}

export async function updateWorkspaceDocAction(
  _prev: DocState,
  formData: FormData,
): Promise<DocState> {
  const parsed = updateWorkspaceDocSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    docId: formData.get("docId"),
    title: formData.get("title"),
    body: formData.get("body"),
    kind: formData.get("kind") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspaceId, docId, title, body, kind } = parsed.data;

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    await updateWorkspaceDoc(workspaceId, docId, {
      title,
      body,
      kind,
      updatedById: user.id,
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }

  revalidatePath(`/w/${workspaceId}/docs`);
  return undefined;
}
