import { expect, test } from "@playwright/test";
import { NOT_FOUND_TEXT, workspacePath } from "./fixtures/workspace";

/**
 * Uses the storageState saved by auth.setup.ts (wired via this project's
 * `dependencies` in playwright.config.ts) — no login flow here.
 *
 * Because the [ws] route param is a UUID and Next.js's notFound() renders
 * with HTTP 200 (a soft 404), status codes alone prove nothing here.
 * Every assertion below checks for real rendered content AND explicitly
 * asserts the 404 body text is absent.
 */
test("authenticated overview page renders real content, not a 404", async ({
  page,
}) => {
  const response = await page.goto(workspacePath("overview"), {
    waitUntil: "domcontentloaded",
  });
  expect(response?.ok()).toBeTruthy();

  // Real content from src/app/(app)/w/[ws]/overview/page.tsx.
  await expect(
    page.getByRole("heading", { name: "Overview", level: 1 }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByText("Pipeline health at a glance"),
  ).toBeVisible();

  // Explicitly rule out the soft-404 body Next.js's notFound() renders —
  // it comes back as HTTP 200, so this check is load-bearing.
  await expect(page.getByText(NOT_FOUND_TEXT)).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(NOT_FOUND_TEXT);
});

test("assets page renders the library, not a 404", async ({ page }) => {
  const response = await page.goto(workspacePath("assets"), {
    waitUntil: "domcontentloaded",
  });
  expect(response?.ok()).toBeTruthy();

  // Real content from src/app/(app)/w/[ws]/assets/page.tsx.
  await expect(
    page.getByRole("heading", { name: "The workspace's files", level: 1 }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Storage used")).toBeVisible();

  // The [ws] param is a UUID and notFound() returns HTTP 200, so the status
  // code proves nothing on its own — this check is load-bearing.
  await expect(page.getByText(NOT_FOUND_TEXT)).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(NOT_FOUND_TEXT);
});
