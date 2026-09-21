import { expect, test } from "@playwright/test";
import { platinaPath } from "../fixtures/platina";

/**
 * The live 3D flow draws for real: a WebGL canvas with non-blank pixels, the
 * HTML labels placed over their nodes, the text list of the same numbers,
 * and no page errors. Screenshot kept as evidence (test-results/).
 */
test("live flow draws the 3D pipeline with labels and a text fallback", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(platinaPath("live"), { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "How your intelligence flows, right now", level: 1 })).toBeVisible({
    timeout: 60_000,
  });

  const scene = page.getByRole("img", { name: /Live flow:/ });
  await expect(scene).toBeVisible();
  const canvas = scene.locator("canvas");
  await expect(canvas).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByText("Drawing the live flow…")).toHaveCount(0, { timeout: 30_000 });

  // Let a few frames run, then prove the canvas is not a blank rectangle.
  await page.waitForTimeout(1_500);
  const shot = await canvas.screenshot();
  await info.attach("live-flow", { body: shot, contentType: "image/png" });
  const distinct = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 97) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    return seen.size;
  }, shot.toString("base64"));
  expect(distinct, "the scene drew more than a flat background").toBeGreaterThan(20);

  // Labels were positioned (made visible) by the render loop.
  const brainLabel = scene.getByText(/^Brain/).first();
  await expect(brainLabel).toBeVisible();

  // The accessible text version of the same numbers.
  await expect(page.getByRole("region", { name: "The same numbers as a list" })).toContainText("Collected");

  expect(errors, "no page errors").toEqual([]);
});
