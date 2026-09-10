import { afterEach, describe, expect, it, vi } from "vitest";
import { apifyConfigured, bedrockConfigured, metaConnectorEnabled } from "./flags";

afterEach(() => vi.unstubAllEnvs());

describe("feature flags", () => {
  it("meta connector is off unless META_CONNECTOR_ENABLED=true", () => {
    vi.stubEnv("META_CONNECTOR_ENABLED", "");
    expect(metaConnectorEnabled()).toBe(false);
    vi.stubEnv("META_CONNECTOR_ENABLED", "true");
    expect(metaConnectorEnabled()).toBe(true);
  });

  it("apify is configured when a token is present", () => {
    vi.stubEnv("APIFY_TOKEN", "");
    expect(apifyConfigured()).toBe(false);
    vi.stubEnv("APIFY_TOKEN", "apify_api_xyz");
    expect(apifyConfigured()).toBe(true);
  });

  it("bedrock requires region and both AWS credentials", () => {
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "");
    expect(bedrockConfigured()).toBe(false);
    vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIA_TEST");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "secret");
    expect(bedrockConfigured()).toBe(true);
  });
});
