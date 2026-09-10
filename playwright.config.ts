import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/**
 * E2E harness for the Next.js App Router app. Scoped entirely to `e2e/` so
 * it never collides with Vitest, which owns `src/**\/*.test.ts`
 * (see vitest.config.ts).
 *
 * Dev-mode reality this config is tuned for: the first request to any
 * route triggers an on-demand compile that can take 5-20s, so navigation
 * and action timeouts are set generously rather than at Playwright's
 * defaults.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Auth setup runs first and writes storageState to disk; a second
  // worker running concurrently could race that write, and the app itself
  // is a single dev server with no isolation between test data anyway.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },

  // Generous top-level timeouts for the same dev-compile reason as above.
  timeout: 90_000,
  expect: {
    timeout: 30_000,
  },

  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: path.join(__dirname, "e2e", ".auth", "user.json"),
      },
      dependencies: ["setup"],
    },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
