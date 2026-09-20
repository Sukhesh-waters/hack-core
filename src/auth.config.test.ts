import { describe, expect, it } from "vitest";
import { authConfig } from "./auth.config";

type AuthorizedArgs = Parameters<
  NonNullable<NonNullable<typeof authConfig.callbacks>["authorized"]>
>[0];

function call(pathname: string, signedIn: boolean) {
  const args = {
    auth: signedIn ? { user: { id: "u1" } } : null,
    request: { nextUrl: new URL(`http://localhost:3000${pathname}`) },
  } as unknown as AuthorizedArgs;
  return authConfig.callbacks.authorized(args);
}

describe("authorized (route gate)", () => {
  it("blocks signed-out users everywhere the matcher applies", () => {
    expect(call("/p/ws1/plan", false)).toBe(false);
    expect(call("/w/ws1/ideation", false)).toBe(false);
  });

  it("lets signed-in users reach Platina and the hub", () => {
    expect(call("/p/ws1/plan", true)).toBe(true);
    expect(call("/hub", true)).toBe(true);
  });

  it("sends the hidden InstaMedia surface back to the hub", async () => {
    for (const path of ["/w", "/w/ws1", "/w/ws1/ideation"]) {
      const result = call(path, true);
      expect(result).toBeInstanceOf(Response);
      const res = result as Response;
      expect(res.status).toBe(302);
      expect(new URL(res.headers.get("location") as string).pathname).toBe(
        "/hub",
      );
    }
  });

  it("does not treat lookalike paths as the InstaMedia surface", () => {
    expect(call("/workspace/new", true)).toBe(true);
  });
});
