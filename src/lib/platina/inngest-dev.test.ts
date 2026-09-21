import { afterEach, describe, expect, it, vi } from "vitest";
import { inngestDevUrl, probeInngestDev } from "./inngest-dev";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("inngestDevUrl", () => {
  it("is null outside dev mode", () => {
    vi.stubEnv("INNGEST_DEV", "");
    expect(inngestDevUrl()).toBeNull();
  });

  it("defaults to the standard local dev server for INNGEST_DEV=1", () => {
    vi.stubEnv("INNGEST_DEV", "1");
    vi.stubEnv("INNGEST_BASE_URL", "");
    expect(inngestDevUrl()).toBe("http://localhost:8288");
  });

  it("honours a custom base URL, or a URL given as the INNGEST_DEV value", () => {
    vi.stubEnv("INNGEST_DEV", "1");
    vi.stubEnv("INNGEST_BASE_URL", "http://localhost:9999");
    expect(inngestDevUrl()).toBe("http://localhost:9999");
    vi.stubEnv("INNGEST_DEV", "http://localhost:1234");
    expect(inngestDevUrl()).toBe("http://localhost:1234");
  });
});

describe("probeInngestDev", () => {
  it("does not apply outside dev mode, and makes no request", async () => {
    vi.stubEnv("INNGEST_DEV", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await probeInngestDev()).toBe("not_dev");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is up when the server answers, whatever the HTTP status", async () => {
    vi.stubEnv("INNGEST_DEV", "1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404 }));
    expect(await probeInngestDev()).toBe("up");
  });

  it("is down when the connection is refused — the silent failure made definite", async () => {
    vi.stubEnv("INNGEST_DEV", "1");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await probeInngestDev()).toBe("down");
  });
});
