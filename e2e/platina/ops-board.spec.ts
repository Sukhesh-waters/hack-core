import { expect, test } from "@playwright/test";
import { NOT_FOUND_TEXT, platinaPath } from "../fixtures/platina";

/**
 * C7.1 ops board on Admin -> Health: the stored checks render with a status
 * and a 7-day strip, and "Run checks now" queues a run that lands on the
 * board. Needs the job runner (npm run dev:all) for the run to complete.
 */
test("ops board shows every flow's status and runs the checks on demand", async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(platinaPath("admin/health"), { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Operations health", level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("body")).not.toContainText(NOT_FOUND_TEXT);

  const board = page.getByRole("region", { name: "Ops board" });
  await expect(board.getByRole("heading", { name: "Ops board" })).toBeVisible();
  await board.getByRole("button", { name: "Run checks now" }).click();
  await expect(page).toHaveURL(/running=1/, { timeout: 60_000 });

  // The run lands: every check shows, each with a status and its 7-day strip.
  for (const label of [
    "First-party knowledge is the client's own",
    "Embeddings (search vectors)",
    "Budgets (projected to period end)",
    "Runs finishing",
  ]) {
    await expect(board.getByText(label, { exact: true })).toBeVisible({ timeout: 120_000 });
  }
  await expect(board.getByLabel("Last 7 days, oldest first").first()).toBeVisible();
  await expect(board).toContainText(/Last checked (just now|\d+ min ago)/);

  // The collection checks stay on the same page.
  await expect(page.getByRole("region", { name: "Collection right now" })).toBeVisible();
  expect(errors).toEqual([]);
});
