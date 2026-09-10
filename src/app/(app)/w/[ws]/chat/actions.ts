"use server";

import { requireUser } from "@/auth";
import {
  createAsset,
  linkAsset,
  workspaceStorageUsed,
} from "@/db/queries/assets";
import {
  getOrCreateDirectConversation,
  insertDirectMessage,
  listConversationMessages,
  listUserConversations,
  markConversationRead,
  type ConversationSummary,
  type DirectMessageItem,
} from "@/db/queries/direct-messages";
import {
  requireCapability,
  requireMembership,
} from "@/db/queries/memberships";
import { actionErrorMessage } from "@/lib/action-errors";
import {
  checkAssetUpload,
  safeFilename,
  storagePathFor,
} from "@/lib/assets";
import { broadcastSignal } from "@/lib/realtime";
import { putObject, removeObject } from "@/lib/storage";

export type ChatAttachmentItem = {
  assetId: string;
  filename: string;
  mime: string;
  bytes: number;
  kind: string;
};

export async function fetchConversationsAction(
  workspaceId: string,
): Promise<{ ok: boolean; conversations?: ConversationSummary[]; error?: string }> {
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    const conversations = await listUserConversations(workspaceId, user.id);
    return { ok: true, conversations };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}

export async function fetchMessagesAction(
  workspaceId: string,
  conversationId: string,
): Promise<{ ok: boolean; messages?: DirectMessageItem[]; error?: string }> {
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    const messages = await listConversationMessages(
      workspaceId,
      conversationId,
      user.id,
    );
    return { ok: true, messages };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}

export async function startDirectChatAction(
  workspaceId: string,
  recipientUserId: string,
): Promise<{ ok: boolean; conversationId?: string; error?: string }> {
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    if (user.id === recipientUserId) {
      return { ok: false, error: "Cannot start a direct message with yourself." };
    }
    const { id } = await getOrCreateDirectConversation(
      workspaceId,
      user.id,
      recipientUserId,
    );
    await broadcastSignal(workspaceId, "dm");
    return { ok: true, conversationId: id };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}

export async function uploadChatAttachmentAction(
  workspaceId: string,
  formData: FormData,
): Promise<{
  ok: boolean;
  attachment?: ChatAttachmentItem;
  error?: string;
}> {
  try {
    const user = await requireUser();
    await requireCapability(workspaceId, user.id, "asset.upload");

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Choose a file to attach." };
    }

    const usedBytes = await workspaceStorageUsed(workspaceId);
    const check = checkAssetUpload({
      filename: file.name,
      mime: file.type,
      bytes: file.size,
      usedBytes,
    });
    if (!check.ok) return { ok: false, error: check.reason };

    const assetId = crypto.randomUUID();
    const storagePath = storagePathFor(workspaceId, assetId);

    await putObject(storagePath, await file.arrayBuffer(), file.type);

    try {
      await createAsset({
        id: assetId,
        workspaceId,
        uploadedById: user.id,
        filename: safeFilename(file.name),
        mime: file.type,
        bytes: file.size,
        storagePath,
        kind: check.kind,
        linkedType: "direct_message",
      });
    } catch (insertError) {
      await removeObject(storagePath).catch(() => {});
      throw insertError;
    }

    return {
      ok: true,
      attachment: {
        assetId,
        filename: safeFilename(file.name),
        mime: file.type,
        bytes: file.size,
        kind: check.kind,
      },
    };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}

export async function sendDirectMessageAction(
  workspaceId: string,
  conversationId: string,
  body: string,
  attachments?: Record<string, unknown>[],
): Promise<{ ok: boolean; message?: DirectMessageItem; error?: string }> {
  try {
    const trimmed = body.trim();
    if (!trimmed && (!attachments || attachments.length === 0)) {
      return { ok: false, error: "Message cannot be empty." };
    }
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    const message = await insertDirectMessage({
      workspaceId,
      conversationId,
      senderId: user.id,
      body: trimmed,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
    });
    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        if (typeof att.assetId === "string") {
          await linkAsset(workspaceId, att.assetId, "direct_message", message.id).catch(() => {});
        }
      }
    }
    await broadcastSignal(workspaceId, "dm");
    return { ok: true, message };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}

export async function markConversationReadAction(
  workspaceId: string,
  conversationId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await requireUser();
    await requireMembership(workspaceId, user.id);
    await markConversationRead(workspaceId, conversationId, user.id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error) };
  }
}
