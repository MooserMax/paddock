import { defineConfig } from "@playwright/test";

// Points at an already-running dev/preview server (default :3002). Override with
// PADDOCK_URL. Two viewports: a true 380px mobile and a desktop reference.
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  // The signing-path and API tests must be deterministic; warmup removes the
  // cold-compile flake, and a single retry covers any residual dev-server jitter.
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.PADDOCK_URL || "http://localhost:3002",
    trace: "off",
  },
  projects: [
    { name: "mobile-380", use: { viewport: { width: 380, height: 820 }, deviceScaleFactor: 2 } },
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
  ],
});
