import { afterEach, describe, expect, it, vi } from "vitest";
import { broadcastHubSignal, broadcastSignal, hubChannelName } from "./realtime";

describe("hubChannelName", () => {
  it("builds the per-workspace topic", () => {
    expect(hubChannelName("abc123")).toBe("ws:abc123:hub");
  });
});

describe("broadcastSignal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function stubEnv() {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-key");
  }

  it("never throws when the fetch fails (degradation ladder)", async () => {
    stubEnv();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    await expect(
      broadcastSignal("abc123", "messages"),
    ).resolves.toBeUndefined();
  });

  it("posts a signal-only payload — no tenant content fields", async () => {
    stubEnv();
    const spy = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", spy);
    await broadcastSignal("abc123", "tasks");
    const body = JSON.parse(spy.mock.calls[0][1].body as string);
    expect(body.messages[0].topic).toBe("ws:abc123:hub");
    expect(body.messages[0].payload).toEqual({ scope: "tasks" });
  });

  it("accepts new D1 scopes (sop, workflow, cockpit)", async () => {
    stubEnv();
    const spy = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", spy);

    for (const scope of ["sop", "workflow", "cockpit"] as const) {
      await broadcastSignal("ws1", scope);
      const body = JSON.parse(spy.mock.lastCall![1].body as string);
      expect(body.messages[0].payload).toEqual({ scope });
    }
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("accepts the calendar scope", async () => {
    stubEnv();
    const spy = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", spy);
    await broadcastSignal("ws1", "calendar");
    const body = JSON.parse(spy.mock.calls[0][1].body as string);
    expect(body.messages[0].payload).toEqual({ scope: "calendar" });
  });

  it("accepts the dm scope", async () => {
    stubEnv();
    const spy = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", spy);
    await broadcastSignal("ws1", "dm");
    const body = JSON.parse(spy.mock.calls[0][1].body as string);
    expect(body.messages[0].payload).toEqual({ scope: "dm" });
  });

  it("accepts the kb scope", async () => {
    stubEnv();
    const spy = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", spy);
    await broadcastSignal("ws1", "kb");
    const body = JSON.parse(spy.mock.calls[0][1].body as string);
    expect(body.messages[0].payload).toEqual({ scope: "kb" });
  });
});

describe("broadcastHubSignal (backward compat)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("delegates to broadcastSignal", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-key");
    const spy = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", spy);
    await broadcastHubSignal("abc123", "tasks");
    const body = JSON.parse(spy.mock.calls[0][1].body as string);
    expect(body.messages[0].payload).toEqual({ scope: "tasks" });
  });
});

