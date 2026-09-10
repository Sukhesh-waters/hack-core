import { describe, expect, it } from "vitest";
import {
  getOrCreateDirectConversation,
  listConversationMessages,
  listUserConversations,
  markConversationRead,
} from "./direct-messages";

describe("direct messages queries", () => {
  it("exports conversation and message helpers", () => {
    expect(typeof getOrCreateDirectConversation).toBe("function");
    expect(typeof listUserConversations).toBe("function");
    expect(typeof listConversationMessages).toBe("function");
    expect(typeof markConversationRead).toBe("function");
  });
});
