import { expect, test } from "@playwright/test";
import { platinaPath } from "../fixtures/platina";

/**
 * The C6 learning loop through the real UI, in the e2e fixture workspace:
 * log a creative -> add its numbers -> open the review -> confirm it -> the
 * lesson shows up in "What changed, and why". The review draft may come from
 * a model or (when none is available) be written here; either way nothing is
 * learned until the confirm.
 */
test("log a creative, add numbers, review, confirm: the loop records a lesson", async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const title = `E2E carousel ${Date.now()}`;
  const posted = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);

  await page.goto(platinaPath("results/new"), { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Log a creative", level: 1 })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Channel").selectOption("linkedin");
  await page.getByLabel("Format").selectOption("carousel");
  await page.getByLabel("Topic").fill("e2e topic");
  await page.getByLabel("Posted on").fill(posted);
  await page.getByLabel("What we expect, and why").fill("Lab managers engage with proof of speed more than usual");
  await page.getByRole("button", { name: "Log creative" }).click();

  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Logged. Add its numbers")).toBeVisible();

  await page.getByLabel("Impressions").fill("1000");
  await page.getByLabel("Engagements").fill("30");
  await page.getByRole("button", { name: "Save numbers" }).click();
  await expect(page.getByRole("cell", { name: "3.00%" })).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "Review now" }).click();
  const review = page.getByRole("region", { name: "Review" });
  await expect(review.getByText("Measured (computed, not written by the AI)")).toBeVisible({ timeout: 120_000 });
  await expect(review).toContainText("engagement rate: 3.00%");

  await review.getByLabel("Did it work?").selectOption("worked");
  const what = review.getByLabel("What happened");
  if ((await what.inputValue()).trim().length < 5) await what.fill("It reached lab managers and drew comments.");
  const how = review.getByLabel("How: the one change to make next time");
  if ((await how.inputValue()).trim().length < 5) await how.fill("Try the same proof as a short video.");
  await review.getByRole("button", { name: "Confirm and learn" }).click();

  await expect(page.getByText("Confirmed and learned")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("region", { name: "Review" })).toContainText("Worked");

  await page.goto(platinaPath("results"), { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Results", level: 1 })).toBeVisible({ timeout: 60_000 });
  const changes = page.getByRole("region", { name: "What results are teaching" });
  await expect(changes).toContainText("Lesson stored");
  await expect(changes).toContainText(title);
  await expect(page.getByRole("link", { name: title })).toBeVisible();

  expect(errors).toEqual([]);
});
