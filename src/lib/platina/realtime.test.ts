import { afterEach, describe, expect, it } from "vitest";
import { platinaChannelName } from "./realtime";
import { platinaTopicToken } from "./realtime-server";

const SECRET = "test-secret";
const WS_A = "1f3f82d4-470a-494d-8e56-29ac9372e94f";
const WS_B = "0b8b1f2e-0000-4000-8000-0000000000b1";

afterEach(() => {
  delete process.env.PLATINA_REALTIME_SECRET;
});

describe("platina realtime topic token", () => {
  it("returns null when the secret is absent — callers degrade to polling", () => {
    delete process.env.PLATINA_REALTIME_SECRET;
    expect(platinaTopicToken(WS_A)).toBeNull();
  });

  it("is opaque: the token contains no trace of the workspace id", () => {
    process.env.PLATINA_REALTIME_SECRET = SECRET;
    const token = platinaTopicToken(WS_A);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toContain(WS_A);
  });

  it("is deterministic per workspace and distinct across workspaces", () => {
    process.env.PLATINA_REALTIME_SECRET = SECRET;
    expect(platinaTopicToken(WS_A)).toBe(platinaTopicToken(WS_A));
    expect(platinaTopicToken(WS_A)).not.toBe(platinaTopicToken(WS_B));
  });

  it("changes with the secret, so rotating it re-keys every channel", () => {
    process.env.PLATINA_REALTIME_SECRET = SECRET;
    const first = platinaTopicToken(WS_A);
    process.env.PLATINA_REALTIME_SECRET = "rotated";
    expect(platinaTopicToken(WS_A)).not.toBe(first);
  });

  it("names the channel platina:<token>:live", () => {
    process.env.PLATINA_REALTIME_SECRET = SECRET;
    const token = platinaTopicToken(WS_A)!;
    expect(platinaChannelName(token)).toBe(`platina:${token}:live`);
  });
});
