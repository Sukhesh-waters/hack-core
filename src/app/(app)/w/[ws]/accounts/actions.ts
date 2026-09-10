"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { db } from "@/db";
import { connectedAccounts } from "@/db/schema";
import { getConnectedAccount, updateHeartbeat } from "@/db/queries/accounts";
import {
  insertPublicPagePosts,
  listExistingExternalIds,
} from "@/db/queries/harness";
import { requireMembership } from "@/db/queries/memberships";
import { actionErrorMessage } from "@/lib/action-errors";
import { fetchPublicPosts } from "@/lib/connectors/apify";
import { encryptSecret } from "@/lib/crypto";
import { metaConnectorEnabled } from "@/lib/flags";
import { clampCap, dedupeItems, HARNESS_DEFAULT_CAP } from "@/lib/harness";
import { connectMetaSchema, publicPageSchema } from "@/lib/validation";
import { runAccountSync } from "./sync";

export type AccountsActionState = { error?: string; ok?: string } | undefined;

export async function connectMetaAccount(
  _prev: AccountsActionState,
  formData: FormData,
): Promise<AccountsActionState> {
  const parsed = connectMetaSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    clientId: formData.get("clientId"),
    igUserId: formData.get("igUserId"),
    accessToken: formData.get("accessToken"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const user = await requireUser();
    await requireMembership(parsed.data.workspaceId, user.id);
    await db.insert(connectedAccounts).values({
      workspaceId: parsed.data.workspaceId,
      clientId: parsed.data.clientId,
      igUserId: parsed.data.igUserId,
      accessTokenEnc: encryptSecret(parsed.data.accessToken),
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
  revalidatePath(`/w/${parsed.data.workspaceId}/accounts`);
  return { ok: "Account connected. Run a sync to pull history." };
}

export async function syncAccount(
  _prev: AccountsActionState,
  formData: FormData,
): Promise<AccountsActionState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const accountId = String(formData.get("accountId") ?? "");
  if (!metaConnectorEnabled()) {
    return { error: "Meta connector is disabled until app review clears." };
  }

  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    const account = await getConnectedAccount(workspaceId, accountId);
    if (!account || account.status === "disconnected") {
      return { error: "Account not found or disconnected." };
    }
    await runAccountSync(workspaceId, account);
  } catch (error) {
    await updateHeartbeat(workspaceId, accountId, {
      status: "error",
      lastError: actionErrorMessage(error),
    }).catch(() => {});
    return { error: actionErrorMessage(error) };
  }
  revalidatePath(`/w/${workspaceId}/accounts`);
  return { ok: "Sync complete." };
}

export async function disconnectAccount(
  _prev: AccountsActionState,
  formData: FormData,
): Promise<AccountsActionState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const accountId = String(formData.get("accountId") ?? "");
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    await updateHeartbeat(workspaceId, accountId, { status: "disconnected" });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
  revalidatePath(`/w/${workspaceId}/accounts`);
  return { ok: "Disconnected." };
}

export async function addPublicPage(
  _prev: AccountsActionState,
  formData: FormData,
): Promise<AccountsActionState> {
  const parsed = publicPageSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    handle: formData.get("handle"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const user = await requireUser();
    await requireMembership(parsed.data.workspaceId, user.id);
    // Enforce the constitution's hard cap structurally, not by relying on
    // fetchPublicPosts's default — so wiring a user-facing count field to this
    // path later can never bypass HARNESS_HARD_CAP.
    const items = await fetchPublicPosts(
      parsed.data.handle,
      clampCap(HARNESS_DEFAULT_CAP),
    );
    if (items.length === 0) {
      return { error: "No public posts found for that handle." };
    }
    const existing = await listExistingExternalIds(
      parsed.data.workspaceId,
      items.flatMap((i) => (i.externalId ? [i.externalId] : [])),
    );
    const fresh = dedupeItems(items, existing);
    if (fresh.length === 0) {
      return { ok: `No new posts from @${parsed.data.handle} — already up to date.` };
    }
    await insertPublicPagePosts({
      workspaceId: parsed.data.workspaceId,
      handle: parsed.data.handle,
      items: fresh,
    });
  } catch (error) {
    return { error: actionErrorMessage(error) };
  }
  revalidatePath(`/w/${parsed.data.workspaceId}/accounts`);
  return { ok: `Pattern layer updated from @${parsed.data.handle}.` };
}
