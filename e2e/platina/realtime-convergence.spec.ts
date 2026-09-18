import { expect, test } from "@playwright/test";
import { platinaPath } from "../fixtures/platina";

/**
 * Slice 14 item 5 — Realtime convergence proof.
 *
 * Two tabs (two pages in the same authenticated browser context) never talk
 * to each other directly; the only channel between them is the Supabase
 * Realtime broadcast the server fires after a committed write
 * (src/lib/platina/realtime-server.ts), gated on PLATINA_REALTIME_SECRET
 * being set for the dev server this config launches. Both tabs must reach
 * "Live" before the write, or this test would only prove the 20s polling
 * fallback (PLATINA_POLL_INTERVAL_MS), not Realtime itself — so it asserts
 * the transport state first, then requires convergence well inside a
 * window the poll fallback cannot satisfy on its own.
 */
test("a run triggered in tab A appears in tab B without a manual refresh", async ({
  page: tabA,
  context,
}) => {
  const tabB = await context.newPage();

  await tabA.goto(platinaPath("audits"), { waitUntil: "domcontentloaded" });
  await tabB.goto(platinaPath("audits"), { waitUntil: "domcontentloaded" });

  await expect(tabA.getByText("Live", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(tabB.getByText("Live", { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  // Self-contained: create a fresh draft source in tab A rather than
  // depending on pre-seeded scan specs (scripts/seed-platina-fixture.ts
  // does not seed one). A unique name keeps repeat runs collision-free.
  const sourceName = `Realtime convergence check ${Date.now()}`;
  await tabA.getByPlaceholder(/Competitor watch/).fill(sourceName);
  await tabA
    .getByPlaceholder(/https:\/\/competitor\.example\.com/)
    .fill(`https://example.com/${Date.now()}`);
  await tabA.getByRole("button", { name: "Save as draft" }).click();
  await expect(tabA.getByText(sourceName)).toBeVisible({ timeout: 30_000 });

  const runRows = 'section[aria-label="Run history"] tbody tr';
  const runsBefore = await tabB.locator(runRows).count();

  // Fire the write from tab A: "Approve audit scope" kicks off the first
  // run and broadcasts `audits` (src/app/(platina)/p/[ws]/actions.ts,
  // confirmScanAction) — the signal tab B must pick up without reloading.
  const specRow = tabA.locator("tr", { hasText: sourceName });
  await specRow.getByRole("button", { name: "Approve audit scope" }).click();

  await expect(async () => {
    const runsAfter = await tabB.locator(runRows).count();
    expect(runsAfter).toBeGreaterThan(runsBefore);
  }).toPass({ timeout: 12_000 });
});
