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
    // PROD GUARD (2026-08, after Playwright runs polluted the prod DB with
    // 190+ t7-*/e2e-* test tenants — cleaned). Non-local targets require an
    // explicit double opt-in: PLAYWRIGHT_BASE_URL=<host> + PLAYWRIGHT_ALLOW_PROD=1.
    // Tests that need to verify the deployed app MUST set both.
    baseURL: (() => {
      const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
      const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(base);
      if (!isLocal && process.env.PLAYWRIGHT_ALLOW_PROD !== "1") {
        throw new Error(
          `Refusing to run E2E against non-local host: ${base}. ` +
            "This was the source of ~190 test tenants in the prod DB (cleaned 2026-08-13). " +
            "Set PLAYWRIGHT_ALLOW_PROD=1 to confirm you intentionally target a deployed host."
        );
      }
      return base;
    })(),
    headless: true,
    trace: "retain-on-failure",
  },
});
