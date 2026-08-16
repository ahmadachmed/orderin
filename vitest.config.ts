import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // tsconfig keeps jsx:"preserve" for Next.js; transform JSX in tests so
  // rolldown-vite (oxc) can parse .tsx test files.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    // TEST-02: component tests run in jsdom (React Testing Library).
    // Integration tests that hit a real Postgres or need Node-only globals
    // override per-file with `// @vitest-environment node` at the top.
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Integration tests hit a real Postgres; keep runs fast and isolated.
    fileParallelism: false,
    // Cap-enforcement integration tests seed hundreds of rows (e.g. 300
    // sequential prisma.order.create in the T8 monthly-cap suite) and take
    // 11-13s per test locally — far over vitest's 5s default. Raise the
    // per-test budget so plain `npm test` passes without --testTimeout.
    testTimeout: 60000,
    // afterAll cleanupTenant() deletes those hundreds of seeded rows
    // sequentially — also over vitest's 10s hook default.
    hookTimeout: 60000,
  },
});
