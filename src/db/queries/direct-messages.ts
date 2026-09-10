import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  conversationParticipants,
  conversations,
  directMessages,
  users,
} from "@/db/schema";

export type ConversationSummary = {
  id: string;
  workspaceId: string;
  type: "direct" | "group";
  title: string | null;
  updatedAt: Date;
  otherParticipant: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  } | null;
  lastMessage: {
    id: string;
    body: string;
    senderId: string;
    createdAt: Date;
  } | null;
  unreadCount: number;
};

export type DirectMessageItem = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string | null;
  senderEmail: string;
  senderImage: string | null;
  body: string;
  attachments: Record<string, unknown>[] | null;
  createdAt: Date;
};

/**
 * Finds or creates a 1:1 direct conversation between two workspace members.
 */
export async function getOrCreateDirectConversation(
  workspaceId: string,
  userIdA: string,
  userIdB: string,
): Promise<{ id: string; isNew: boolean }> {
  // Find shared direct conversation in this workspace
  const userAConvs = await db
    .select({ conversationId: conversationParticipants.conversationId })
    .from(conversationParticipants)
    .innerJoin(
      conversations,
      eq(conversations.id, conversationParticipants.conversationId),
    )
    .where(
      and(
        eq(conversations.workspaceId, workspaceId),
        eq(conversations.type, "direct"),
        eq(conversationParticipants.userId, userIdA),
      ),
    );

  if (userAConvs.length > 0) {
    const candidateIds = userAConvs.map((c) => c.conversationId);
    const shared = await db
      .select({ conversationId: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .where(
        and(
          inArray(conversationParticipants.conversationId, candidateIds),
          eq(conversationParticipants.userId, userIdB),
        ),
      )
      .limit(1);

    if (shared.length > 0) {
      return { id: shared[0].conversationId, isNew: false };
    }
  }

  // Create new direct conversation
  return await db.transaction(async (tx) => {
    const [conv] = await tx
      .insert(conversations)
      .values({
        workspaceId,
        type: "direct",
      })
      .returning({ id: conversations.id });

    await tx.insert(conversationParticipants).values([
      { conversationId: conv.id, userId: userIdA, lastReadAt: new Date() },
      { conversationId: conv.id, userId: userIdB },
    ]);

    return { id: conv.id, isNew: true };
  });
}

/**
 * Lists all conversations for a user in a workspace with other participant details and unread counts.
 */
export async function listUserConversations(
  workspaceId: string,
  userId: string,
): Promise<ConversationSummary[]> {
  const userConvs = await db
    .select({
      conversation: conversations,
      participant: conversationParticipants,
    })
    .from(conversationParticipants)
    .innerJoin(
      conversations,
      eq(conversations.id, conversationParticipants.conversationId),
    )
    .where(
      and(
        eq(conversations.workspaceId, workspaceId),
        eq(conversationParticipants.userId, userId),
      ),
    )
    .orderBy(desc(conversations.updatedAt));

  if (userConvs.length === 0) return [];

  const conversationIds = userConvs.map((c) => c.conversation.id);

  // Get other participants
  const otherParts = await db
    .select({
      conversationId: conversationParticipants.conversationId,
      user: users,
    })
    .from(conversationParticipants)
    .innerJoin(users, eq(users.id, conversationParticipants.userId))
    .where(
      and(
        inArray(conversationParticipants.conversationId, conversationIds),
        ne(conversationParticipants.userId, userId),
      ),
    );

  const otherPartMap = new Map<string, typeof otherParts[0]["user"]>();
  for (const p of otherParts) {
    otherPartMap.set(p.conversationId, p.user);
  }

  // Get messages for unread counts and last messages
  const allMessages = await db
    .select()
    .from(directMessages)
    .where(inArray(directMessages.conversationId, conversationIds))
    .orderBy(desc(directMessages.createdAt));

  const lastMsgMap = new Map<string, typeof allMessages[0]>();
  const unreadCountMap = new Map<string, number>();

  for (const msg of allMessages) {
    if (!lastMsgMap.has(msg.conversationId)) {
      lastMsgMap.set(msg.conversationId, msg);
    }
  }

  for (const { conversation, participant } of userConvs) {
    const lastRead = participant.lastReadAt ?? new Date(0);
    const unread = allMessages.filter(
      (m) =>
        m.conversationId === conversation.id &&
        m.senderId !== userId &&
        m.createdAt > lastRead,
    ).length;
    unreadCountMap.set(conversation.id, unread);
  }

  return userConvs.map(({ conversation }) => {
    const otherUser = otherPartMap.get(conversation.id);
    const lastMsg = lastMsgMap.get(conversation.id);
    const unreadCount = unreadCountMap.get(conversation.id) ?? 0;

    return {
      id: conversation.id,
      workspaceId: conversation.workspaceId,
      type: conversation.type,
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      otherParticipant: otherUser
        ? {
            id: otherUser.id,
            name: otherUser.name,
            email: otherUser.email,
            image: otherUser.image,
          }
        : null,
      lastMessage: lastMsg
        ? {
            id: lastMsg.id,
            body: lastMsg.body,
            senderId: lastMsg.senderId,
            createdAt: lastMsg.createdAt,
          }
        : null,
      unreadCount,
    };
  });
}

/**
 * Lists messages in a conversation.
 */
export async function listConversationMessages(
  workspaceId: string,
  conversationId: string,
  userId: string,
  limit = 50,
): Promise<DirectMessageItem[]> {
  // Validate participant and workspace membership
  const [participant] = await db
    .select({ conversationId: conversationParticipants.conversationId })
    .from(conversationParticipants)
    .innerJoin(
      conversations,
      eq(conversations.id, conversationParticipants.conversationId),
    )
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.workspaceId, workspaceId),
        eq(conversationParticipants.userId, userId),
      ),
    )
    .limit(1);

  if (!participant) {
    throw new Error("Conversation not found or access denied.");
  }

  const rows = await db
    .select({
      id: directMessages.id,
      conversationId: directMessages.conversationId,
      senderId: directMessages.senderId,
      senderName: users.name,
      senderEmail: users.email,
      senderImage: users.image,
      body: directMessages.body,
      attachments: directMessages.attachments,
      createdAt: directMessages.createdAt,
    })
    .from(directMessages)
    .innerJoin(users, eq(users.id, directMessages.senderId))
    .where(eq(directMessages.conversationId, conversationId))
    .orderBy(desc(directMessages.createdAt))
    .limit(limit);

  return rows.reverse();
}

/**
 * Sends a message in a conversation.
 */
export async function insertDirectMessage({
  workspaceId,
  conversationId,
  senderId,
  body,
  attachments,
}: {
  workspaceId: string;
  conversationId: string;
  senderId: string;
  body: string;
  attachments?: Record<string, unknown>[];
}): Promise<DirectMessageItem> {
  const [participant] = await db
    .select()
    .from(conversationParticipants)
    .innerJoin(
      conversations,
      eq(conversations.id, conversationParticipants.conversationId),
    )
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.workspaceId, workspaceId),
        eq(conversationParticipants.userId, senderId),
      ),
    )
    .limit(1);

  if (!participant) {
    throw new Error("Conversation not found or access denied.");
  }

  return await db.transaction(async (tx) => {
    const now = new Date();
    const [msg] = await tx
      .insert(directMessages)
      .values({
        conversationId,
        senderId,
        body,
        attachments: attachments ?? null,
        createdAt: now,
      })
      .returning();

    await tx
      .update(conversations)
      .set({ updatedAt: now })
      .where(eq(conversations.id, conversationId));

    await tx
      .update(conversationParticipants)
      .set({ lastReadAt: now })
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, senderId),
        ),
      );

    const [sender] = await tx
      .select()
      .from(users)
      .where(eq(users.id, senderId))
      .limit(1);

    return {
      id: msg.id,
      conversationId: msg.conversationId,
      senderId: msg.senderId,
      senderName: sender?.name ?? null,
      senderEmail: sender?.email ?? "",
      senderImage: sender?.image ?? null,
      body: msg.body,
      attachments: msg.attachments,
      createdAt: msg.createdAt,
    };
  });
}

/**
 * Marks a conversation as read for a given user.
 */
export async function markConversationRead(
  workspaceId: string,
  conversationId: string,
  userId: string,
): Promise<void> {
  await db
    .update(conversationParticipants)
    .set({ lastReadAt: new Date() })
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.userId, userId),
      ),
    );
}
