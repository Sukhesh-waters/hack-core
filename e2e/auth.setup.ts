import { expect, test as setup } from "@playwright/test";
import path from "node:path";

/** Where the authenticated storage state is written. Specs depend on this
 *  project (see playwright.config.ts) and reuse the file via their own
 *  `storageState` — they never run this flow themselves. */
export const AUTH_FILE = path.join(__dirname, ".auth", "user.json");

/**
 * Performs the dev-bypass sign-in exactly once per test run and persists
 * cookies to disk. AUTH_DEV_BYPASS=true (set in .env.local) makes the
 * login page render a "Dev bypass (non-production only)" button that
 * submits a Next.js server action and redirects to /hub on success —
 * there's no OAuth flow to drive here.
 */
setup("authenticate via dev bypass", async ({ page }) => {
  await page.goto("/login");

  const bypassButton = page.getByRole("button", {
    name: "Dev bypass (non-production only)",
  });
  await expect(bypassButton).toBeVisible({ timeout: 30_000 });
  await bypassButton.click();

  // Successful sign-in redirects to /hub (the default callbackUrl).
  await page.waitForURL("**/hub", { timeout: 30_000 });
  await expect(
    page.getByText("Where are you working today?"),
  ).toBeVisible({ timeout: 30_000 });

  await page.context().storageState({ path: AUTH_FILE });
});
