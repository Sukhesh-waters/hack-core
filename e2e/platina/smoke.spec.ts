import { expect, test } from "@playwright/test";
import {
  NOT_FOUND_TEXT,
  PLATINA_LEGACY_ROUTES,
  PLATINA_ROUTES,
  platinaPath,
} from "../fixtures/platina";

/**
 * Platina smoke baseline.
 *
 * Uses the storageState saved by auth.setup.ts (wired via this project's
 * `dependencies` in playwright.config.ts) — no login flow here.
 *
 * Because the [ws] route param is a UUID and Next.js's notFound() renders
 * with HTTP 200 (a soft 404), status codes alone prove nothing. Every route
 * assertion checks real rendered content AND explicitly asserts the 404 body
 * text is absent.
 */
test("member renders every primary Platina route", async ({ page }) => {
  for (const route of PLATINA_ROUTES) {
    const response = await page.goto(platinaPath(route.subPath), {
      waitUntil: "domcontentloaded",
    });
    expect(response?.ok(), `${route.subPath || "cockpit"} responded`).toBeTruthy();
    await expect(
      page.getByRole("heading", { name: route.h1, level: 1 }),
      `${route.subPath || "cockpit"} renders its h1`,
    ).toBeVisible({ timeout: 60_000 });
    // The soft-404 check is load-bearing: notFound() returns HTTP 200.
    await expect(page.getByText(NOT_FOUND_TEXT)).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(NOT_FOUND_TEXT);
  }
});

test("legacy Platina routes stay reachable for comparison", async ({
  page,
}) => {
  for (const route of PLATINA_LEGACY_ROUTES) {
    const response = await page.goto(platinaPath(route.subPath), {
      waitUntil: "domcontentloaded",
    });
    expect(
      response?.ok(),
      `legacy ${route.subPath} responded`,
    ).toBeTruthy();
    await expect(
      page.getByRole("heading", { name: route.h1, level: 1 }),
      `legacy ${route.subPath} renders its h1`,
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(NOT_FOUND_TEXT)).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(NOT_FOUND_TEXT);
  }
});

test("unknown workspace renders the soft 404", async ({ page }) => {
  // requireMembership in src/app/(platina)/p/[ws]/layout.tsx throws for a
  // non-member and the layout renders notFound() — the non-member path is a
  // not-found, not a 403.
  await page.goto(`/p/${crypto.randomUUID()}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText(NOT_FOUND_TEXT)).toBeVisible({ timeout: 60_000 });
});

test.describe("unauthenticated", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("unauthenticated visitor is redirected to login", async ({ page }) => {
    // src/middleware.ts matches /p/:path*.
    await page.goto(platinaPath(""), { waitUntil: "domcontentloaded" });
    await page.waitForURL("**/login**", { timeout: 30_000 });
    expect(page.url()).toContain("/login");
  });
});
