"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  Loader2,
  MessageSquare,
  Paperclip,
  Send,
  UserPlus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/assets";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useWorkspaceRealtime } from "@/app/(app)/w/[ws]/use-workspace-realtime";
import { getAssetDownloadUrl } from "@/app/(app)/w/[ws]/assets/actions";
import {
  fetchConversationsAction,
  fetchMessagesAction,
  markConversationReadAction,
  sendDirectMessageAction,
  startDirectChatAction,
  uploadChatAttachmentAction,
  type ChatAttachmentItem,
} from "@/app/(app)/w/[ws]/chat/actions";
import type {
  ConversationSummary,
  DirectMessageItem,
} from "@/db/queries/direct-messages";
import type { WorkspaceMemberOption } from "@/lib/presence";

export function DirectChatDrawer({
  workspaceId,
  currentUserId,
  members,
}: {
  workspaceId: string;
  currentUserId: string;
  members: WorkspaceMemberOption[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DirectMessageItem[]>([]);
  const [newMessageText, setNewMessageText] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachmentItem[]>([]);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Realtime hook for instant DM updates
  const { onlineIds } = useWorkspaceRealtime({
    workspaceId,
    userId: currentUserId,
    scopes: ["dm"],
    onSignal: () => {
      void loadConversations();
      if (activeConvId) {
        void loadMessages(activeConvId);
      }
    },
  });

  const loadConversations = useCallback(async () => {
    const res = await fetchConversationsAction(workspaceId);
    if (res.ok && res.conversations) {
      setConversations(res.conversations);
    }
  }, [workspaceId]);

  const loadMessages = useCallback(
    async (convId: string) => {
      const res = await fetchMessagesAction(workspaceId, convId);
      if (res.ok && res.messages) {
        setMessages(res.messages);
        await markConversationReadAction(workspaceId, convId);
        void loadConversations();
      }
    },
    [workspaceId, loadConversations],
  );

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (activeConvId) {
      void loadMessages(activeConvId);
    }
  }, [activeConvId, loadMessages]);

  useEffect(() => {
    if (activeConvId && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeConvId, messages.length]);

  const totalUnread = conversations.reduce((acc, c) => acc + c.unreadCount, 0);

  const activeConversation = conversations.find((c) => c.id === activeConvId);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    const form = new FormData();
    form.set("file", file);
    setIsUploadingAttachment(true);
    const res = await uploadChatAttachmentAction(workspaceId, form);
    setIsUploadingAttachment(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (res.ok && res.attachment) {
      setPendingAttachments((prev) => [...prev, res.attachment!]);
    }
  }

  async function downloadAttachment(assetId: string) {
    const res = await getAssetDownloadUrl(workspaceId, assetId);
    if (res.url) {
      window.open(res.url, "_blank", "noopener,noreferrer");
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!activeConvId || (!newMessageText.trim() && pendingAttachments.length === 0) || isSending) return;

    const text = newMessageText.trim();
    const currentAttachments = [...pendingAttachments];
    setNewMessageText("");
    setPendingAttachments([]);
    setIsSending(true);

    // Optimistic message
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: DirectMessageItem = {
      id: tempId,
      conversationId: activeConvId,
      senderId: currentUserId,
      senderName: "You",
      senderEmail: "",
      senderImage: null,
      body: text,
      attachments: currentAttachments.length > 0 ? (currentAttachments as unknown as Record<string, unknown>[]) : null,
      createdAt: new Date(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    const res = await sendDirectMessageAction(
      workspaceId,
      activeConvId,
      text,
      currentAttachments.length > 0 ? currentAttachments : undefined,
    );
    setIsSending(false);
    if (res.ok && res.message) {
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? res.message! : m)),
      );
      void loadConversations();
    }
  }

  async function handleStartChat(recipientId: string) {
    const res = await startDirectChatAction(workspaceId, recipientId);
    if (res.ok && res.conversationId) {
      setIsComposing(false);
      setActiveConvId(res.conversationId);
      void loadConversations();
    }
  }

  const otherMembers = members.filter((m) => m.userId !== currentUserId);

  return (
    <div ref={drawerRef} className="fixed bottom-32 right-6 z-40">
      {/* Floating Trigger Button */}
      <button
        type="button"
        aria-label={
          totalUnread > 0
            ? `Team Chat, ${totalUnread} unread`
            : "Team Direct Chat"
        }
        onClick={() => setIsOpen((v) => !v)}
        className="relative flex size-11 items-center justify-center rounded-full border border-border bg-popover/90 text-muted-foreground shadow-lg backdrop-blur hover:text-foreground"
      >
        <MessageSquare className="size-5" aria-hidden />
        {totalUnread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-brand-teal px-1 text-xs font-medium text-primary-foreground">
            {totalUnread > 9 ? "9+" : totalUnread}
          </span>
        ) : null}
      </button>

      {/* Chat Popover Window */}
      {isOpen ? (
        <div className="absolute bottom-14 right-0 flex h-96 w-84 flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl backdrop-blur">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5 bg-muted/40">
            <div className="flex items-center gap-2">
              {activeConvId || isComposing ? (
                <button
                  type="button"
                  onClick={() => {
                    setActiveConvId(null);
                    setIsComposing(false);
                  }}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ArrowLeft className="size-4" />
                </button>
              ) : null}
              <span className="text-sm font-medium text-foreground">
                {isComposing
                  ? "New Message"
                  : activeConversation?.otherParticipant?.name ??
                    activeConversation?.otherParticipant?.email ??
                    "Team Chat"}
              </span>
            </div>

            <div className="flex items-center gap-1">
              {!activeConvId && !isComposing ? (
                <button
                  type="button"
                  onClick={() => setIsComposing(true)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="New chat"
                >
                  <UserPlus className="size-4" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          {isComposing ? (
            <div className="flex-1 overflow-y-auto p-2">
              <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                Start conversation with:
              </p>
              <div className="space-y-1">
                {otherMembers.map((member) => (
                  <button
                    key={member.userId}
                    type="button"
                    onClick={() => void handleStartChat(member.userId)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted"
                  >
                    <Avatar className="size-7 border border-border">
                      <AvatarFallback className="text-xs">
                        {(member.name ?? member.email).slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 truncate">
                      <div className="text-xs font-medium text-foreground">
                        {member.name ?? member.email}
                      </div>
                      {member.name ? (
                        <div className="text-[10px] text-muted-foreground">
                          {member.email}
                        </div>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : activeConvId ? (
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Message Feed */}
              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {messages.map((msg) => {
                  const isMe = msg.senderId === currentUserId;
                  return (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex flex-col gap-0.5",
                        isMe ? "items-end" : "items-start",
                      )}
                    >
                      {msg.body ? (
                        <div
                          className={cn(
                            "max-w-[85%] rounded-lg px-3 py-1.5 text-xs",
                            isMe
                              ? "bg-brand-teal text-primary-foreground"
                              : "bg-muted text-foreground",
                          )}
                        >
                          {msg.body}
                        </div>
                      ) : null}
                      {msg.attachments && msg.attachments.length > 0 ? (
                        <div className="flex flex-col gap-1 max-w-[85%]">
                          {msg.attachments.map((rawAtt, idx) => {
                            const att = rawAtt as {
                              assetId?: string;
                              filename?: string;
                              bytes?: number;
                            };
                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => att.assetId && downloadAttachment(att.assetId)}
                                className={cn(
                                  "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-left text-xs transition",
                                  isMe
                                    ? "border-brand-teal/40 bg-brand-teal/20 text-foreground hover:bg-brand-teal/30"
                                    : "border-border bg-muted/70 text-foreground hover:bg-muted",
                                )}
                              >
                                <Paperclip className="size-3 shrink-0 text-brand-teal" />
                                <span className="truncate max-w-[120px] font-medium">
                                  {att.filename ?? "Attachment"}
                                </span>
                                {typeof att.bytes === "number" ? (
                                  <span className="font-mono text-[9px] text-muted-foreground">
                                    ({formatBytes(att.bytes)})
                                  </span>
                                ) : null}
                                <Download className="size-3 ml-auto opacity-70 shrink-0" />
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      <span className="text-[9px] text-muted-foreground/60">
                        {new Date(msg.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Pending Attachments */}
              {pendingAttachments.length > 0 ? (
                <div className="flex flex-wrap gap-1 border-t border-border bg-muted/20 px-2.5 py-1.5">
                  {pendingAttachments.map((att) => (
                    <span
                      key={att.assetId}
                      className="inline-flex items-center gap-1 rounded bg-brand-teal/15 px-2 py-0.5 font-mono text-[10px] text-brand-teal"
                    >
                      <Paperclip className="size-2.5" />
                      <span className="max-w-[100px] truncate">{att.filename}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setPendingAttachments((prev) =>
                            prev.filter((a) => a.assetId !== att.assetId),
                          )
                        }
                        className="hover:text-destructive"
                      >
                        <X className="size-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              {/* Message Composer */}
              <form
                onSubmit={handleSendMessage}
                className="flex items-center gap-1.5 border-t border-border p-2"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={isUploadingAttachment || isSending}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  title="Attach file"
                >
                  {isUploadingAttachment ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Paperclip className="size-3.5" />
                  )}
                </button>
                <input
                  type="text"
                  value={newMessageText}
                  onChange={(e) => setNewMessageText(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  type="submit"
                  disabled={
                    (!newMessageText.trim() && pendingAttachments.length === 0) ||
                    isSending
                  }
                  className="inline-flex size-7 items-center justify-center rounded-md bg-brand-teal text-primary-foreground hover:bg-brand-teal/90 disabled:opacity-50"
                >
                  <Send className="size-3.5" />
                </button>
              </form>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {conversations.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
                  <p className="text-xs text-muted-foreground">
                    No conversations yet.
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsComposing(true)}
                    className="rounded bg-brand-teal/20 px-2.5 py-1 text-xs font-medium text-brand-teal hover:bg-brand-teal/30"
                  >
                    Start a chat
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {conversations.map((conv) => {
                    const otherUser = conv.otherParticipant;
                    const isOnline = otherUser
                      ? onlineIds.has(otherUser.id)
                      : false;
                    return (
                      <button
                        key={conv.id}
                        type="button"
                        onClick={() => setActiveConvId(conv.id)}
                        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/50"
                      >
                        <div className="relative">
                          <Avatar className="size-8 border border-border">
                            {otherUser?.image ? (
                              <AvatarImage src={otherUser.image} />
                            ) : null}
                            <AvatarFallback className="text-xs">
                              {(otherUser?.name ?? otherUser?.email ?? "U")
                                .slice(0, 2)
                                .toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          {isOnline ? (
                            <span className="absolute bottom-0 right-0 size-2 rounded-full bg-emerald-500 ring-1 ring-popover" />
                          ) : null}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate text-xs font-medium text-foreground">
                              {otherUser?.name ?? otherUser?.email ?? "Chat"}
                            </span>
                            {conv.lastMessage ? (
                              <span className="text-[10px] text-muted-foreground/60">
                                {new Date(
                                  conv.lastMessage.createdAt,
                                ).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            ) : null}
                          </div>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {conv.lastMessage?.body ?? "Started a conversation"}
                          </p>
                        </div>

                        {conv.unreadCount > 0 ? (
                          <span className="flex size-4 items-center justify-center rounded-full bg-brand-teal text-[9px] font-bold text-primary-foreground">
                            {conv.unreadCount}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
