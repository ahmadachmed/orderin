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
  },
});
