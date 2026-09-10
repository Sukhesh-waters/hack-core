import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/db/queries/memberships", () => ({
  requireMembership: vi.fn(),
  requireCapability: vi.fn(),
}));
vi.mock("@/db/queries/direct-messages", () => ({
  getOrCreateDirectConversation: vi.fn(),
  insertDirectMessage: vi.fn(),
  listConversationMessages: vi.fn(),
  listUserConversations: vi.fn(),
  markConversationRead: vi.fn(),
}));
vi.mock("@/db/queries/assets", () => ({
  createAsset: vi.fn(),
  linkAsset: vi.fn(),
  workspaceStorageUsed: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({
  putObject: vi.fn(),
  removeObject: vi.fn(),
}));
vi.mock("@/lib/realtime", () => ({ broadcastSignal: vi.fn() }));

const { requireUser } = await import("@/auth");
const { requireCapability, requireMembership } = await import(
  "@/db/queries/memberships"
);
const {
  getOrCreateDirectConversation,
  insertDirectMessage,
  listConversationMessages,
  listUserConversations,
  markConversationRead,
} = await import("@/db/queries/direct-messages");
const { createAsset, linkAsset, workspaceStorageUsed } = await import(
  "@/db/queries/assets"
);
const { putObject } = await import("@/lib/storage");
const { broadcastSignal } = await import("@/lib/realtime");

const {
  fetchConversationsAction,
  fetchMessagesAction,
  startDirectChatAction,
  sendDirectMessageAction,
  markConversationReadAction,
  uploadChatAttachmentAction,
} = await import("./actions");

const requireUserMock = requireUser as unknown as Mock;
const requireMembershipMock = requireMembership as unknown as Mock;
const requireCapabilityMock = requireCapability as unknown as Mock;
const getOrCreateDirectConversationMock =
  getOrCreateDirectConversation as unknown as Mock;
const insertDirectMessageMock = insertDirectMessage as unknown as Mock;
const listConversationMessagesMock =
  listConversationMessages as unknown as Mock;
const listUserConversationsMock = listUserConversations as unknown as Mock;
const markConversationReadMock = markConversationRead as unknown as Mock;
const broadcastSignalMock = broadcastSignal as unknown as Mock;
const createAssetMock = createAsset as unknown as Mock;
const linkAssetMock = linkAsset as unknown as Mock;
const usedMock = workspaceStorageUsed as unknown as Mock;
const putObjectMock = putObject as unknown as Mock;

describe("Chat Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ id: "user_me", email: "me@example.com" });
    requireMembershipMock.mockResolvedValue({ role: "member" });
  });

  describe("fetchConversationsAction", () => {
    it("returns conversations for authenticated user", async () => {
      listUserConversationsMock.mockResolvedValue([
        {
          id: "c1",
          workspaceId: "ws1",
          type: "direct",
          title: null,
          updatedAt: new Date(),
          otherParticipant: { id: "user_other", name: "Other", email: "other@example.com", image: null },
          lastMessage: null,
          unreadCount: 0,
        },
      ]);

      const res = await fetchConversationsAction("ws1");
      expect(res.ok).toBe(true);
      expect(res.conversations).toHaveLength(1);
      expect(requireMembershipMock).toHaveBeenCalledWith("ws1", "user_me");
    });
  });

  describe("fetchMessagesAction", () => {
    it("returns messages for conversation", async () => {
      listConversationMessagesMock.mockResolvedValue([
        {
          id: "m1",
          conversationId: "c1",
          senderId: "user_other",
          senderName: "Other",
          senderEmail: "other@example.com",
          senderImage: null,
          body: "Hi!",
          attachments: null,
          createdAt: new Date(),
        },
      ]);

      const res = await fetchMessagesAction("ws1", "c1");
      expect(res.ok).toBe(true);
      expect(res.messages).toHaveLength(1);
      expect(listConversationMessagesMock).toHaveBeenCalledWith("ws1", "c1", "user_me");
    });
  });

  describe("startDirectChatAction", () => {
    it("creates conversation and broadcasts dm signal", async () => {
      getOrCreateDirectConversationMock.mockResolvedValue({ id: "c1", isNew: true });

      const res = await startDirectChatAction("ws1", "user_other");
      expect(res.ok).toBe(true);
      expect(res.conversationId).toBe("c1");
      expect(broadcastSignalMock).toHaveBeenCalledWith("ws1", "dm");
    });

    it("prevents chatting with self", async () => {
      const res = await startDirectChatAction("ws1", "user_me");
      expect(res.ok).toBe(false);
      expect(res.error).toContain("Cannot start a direct message with yourself");
      expect(broadcastSignalMock).not.toHaveBeenCalled();
    });
  });

  describe("sendDirectMessageAction", () => {
    it("inserts message and broadcasts dm signal", async () => {
      insertDirectMessageMock.mockResolvedValue({
        id: "m1",
        conversationId: "c1",
        senderId: "user_me",
        senderName: "Me",
        senderEmail: "me@example.com",
        senderImage: null,
        body: "Hello!",
        attachments: null,
        createdAt: new Date(),
      });

      const res = await sendDirectMessageAction("ws1", "c1", "Hello!");
      expect(res.ok).toBe(true);
      expect(res.message?.body).toBe("Hello!");
      expect(broadcastSignalMock).toHaveBeenCalledWith("ws1", "dm");
    });

    it("allows empty message body if attachments are present and links assets", async () => {
      insertDirectMessageMock.mockResolvedValue({
        id: "m_att",
        conversationId: "c1",
        senderId: "user_me",
        senderName: "Me",
        senderEmail: "me@example.com",
        senderImage: null,
        body: "",
        attachments: [{ assetId: "as_1", filename: "doc.pdf" }],
        createdAt: new Date(),
      });
      linkAssetMock.mockResolvedValue(undefined);

      const res = await sendDirectMessageAction("ws1", "c1", "", [
        { assetId: "as_1", filename: "doc.pdf" },
      ]);
      expect(res.ok).toBe(true);
      expect(linkAssetMock).toHaveBeenCalledWith(
        "ws1",
        "as_1",
        "direct_message",
        "m_att",
      );
      expect(broadcastSignalMock).toHaveBeenCalledWith("ws1", "dm");
    });
  });

  describe("uploadChatAttachmentAction", () => {
    it("uploads chat file, creates asset, and returns attachment metadata", async () => {
      requireCapabilityMock.mockResolvedValue({ role: "member" });
      usedMock.mockResolvedValue(0);
      putObjectMock.mockResolvedValue(undefined);
      createAssetMock.mockResolvedValue(undefined);

      const form = new FormData();
      const file = new File([new Uint8Array(10)], "guide.pdf", {
        type: "application/pdf",
      });
      form.set("file", file);

      const res = await uploadChatAttachmentAction("ws1", form);

      expect(res.ok).toBe(true);
      expect(res.attachment).toMatchObject({
        filename: "guide.pdf",
        mime: "application/pdf",
        bytes: 10,
        kind: "doc",
      });
      expect(createAssetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "ws1",
          uploadedById: "user_me",
          filename: "guide.pdf",
          linkedType: "direct_message",
        }),
      );
    });
  });

  describe("markConversationReadAction", () => {
    it("marks conversation read", async () => {
      markConversationReadMock.mockResolvedValue(undefined);
      const res = await markConversationReadAction("ws1", "c1");
      expect(res.ok).toBe(true);
      expect(markConversationReadMock).toHaveBeenCalledWith("ws1", "c1", "user_me");
    });
  });
});
