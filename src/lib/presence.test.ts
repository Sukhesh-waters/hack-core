import { describe, expect, it } from "vitest";
import { resolveOnlineMembers } from "./presence";

const members = [
  { userId: "u1", name: "Ada Lovelace", email: "ada@example.com" },
  { userId: "u2", name: null, email: "b@example.com" },
  { userId: "u3", name: "Charlie", email: "c@example.com" },
];

describe("resolveOnlineMembers", () => {
  it("returns an empty list when no one is online", () => {
    expect(resolveOnlineMembers(new Set(), members)).toEqual([]);
  });

  it("resolves online ids to display labels, preferring name over email", () => {
    const result = resolveOnlineMembers(new Set(["u1", "u2"]), members);
    expect(result).toEqual([
      { id: "u1", label: "Ada Lovelace" },
      { id: "u2", label: "b@example.com" },
    ]);
  });

  it("drops a stale presence id with no matching member", () => {
    const result = resolveOnlineMembers(new Set(["u1", "ghost"]), members);
    expect(result).toEqual([{ id: "u1", label: "Ada Lovelace" }]);
  });

  it("sorts by label for a stable render order", () => {
    const result = resolveOnlineMembers(new Set(["u3", "u1"]), members);
    expect(result).toEqual([
      { id: "u1", label: "Ada Lovelace" },
      { id: "u3", label: "Charlie" },
    ]);
  });
});
