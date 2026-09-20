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
  it("blocks signed-out users on every gated surface", () => {
    for (const path of ["/hub", "/w/ws1/ideation", "/p/ws1/plan"]) {
      expect(call(path, false)).toBe(false);
    }
  });

  it("lets signed-in users reach InstaMedia workspaces, Platina, and the hub", () => {
    for (const path of ["/hub", "/w/ws1/ideation", "/p/ws1/plan"]) {
      expect(call(path, true)).toBe(true);
    }
  });
});
