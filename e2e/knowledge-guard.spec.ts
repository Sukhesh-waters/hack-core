import { expect, test } from "@playwright/test";
import { NOT_FOUND_TEXT, workspacePath } from "./fixtures/workspace";

const CLIENT_ID = "0278c0fd-ce78-4e02-aa61-e0a022c84f07"; // E2E Fixture Client

/**
 * C7.0 two-layer guard through the real UI: a page that is not on the
 * client's own list is refused before anything is fetched, the person is
 * offered "Belongs to <client>", and the own list can be edited. No page is
 * actually read here (no Firecrawl credit is spent).
 */
test("knowledge ingest refuses a page that isn't the client's own; the own list is editable", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(workspacePath(`brand-gene?client=${CLIENT_ID}&tab=knowledge`), { waitUntil: "domcontentloaded" });
  await expect(page.getByText("E2E Fixture Client's own sites and pages")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("body")).not.toContainText(NOT_FOUND_TEXT);

  // Refused: not on the own list. The URL stays, and the confirm box appears.
  const url = page.getByPlaceholder("https://example.com/about");
  await url.fill("https://www.thermofisher.com/in/en/home.html?utm_source=e2e");
  await page.getByRole("button", { name: /Ingest (URL|site)/ }).click();
  await expect(page.getByText(/thermofisher\.com isn't on E2E Fixture Client's list/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByLabel(/Belongs to E2E Fixture Client/)).toBeVisible();
  await expect(url).toHaveValue(/thermofisher\.com/);

  // Add and remove an own site.
  const own = `e2e-own-${Date.now()}.example.com`;
  await page.getByLabel("Own website or page").fill(own);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const chip = page.getByRole("listitem").filter({ hasText: own.replace(/^e2e-own-\d+\./, "") });
  await expect(page.getByText(/^Added /)).toBeVisible({ timeout: 60_000 });
  await expect(chip.first()).toBeVisible();
  await chip.first().getByRole("button", { name: /^Remove / }).click();
  await expect(chip).toHaveCount(0, { timeout: 60_000 });

  expect(errors).toEqual([]);
});
