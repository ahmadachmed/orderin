// TEST-03 — Playwright E2E (PLAN §11 / issue #24).
// Runs against a locally started dev server (npm run dev) on :3000.
// CI starts the server itself in the conditional `e2e` job (label-gated).
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    // Overridable so local runs can target a dev server that fell back to a
    // different port (e.g. PLAYWRIGHT_BASE_URL=http://localhost:3002); CI
    // always uses the default :3000.
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    headless: true,
    trace: "retain-on-failure",
  },
});
