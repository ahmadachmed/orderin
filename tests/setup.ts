// TEST-02: global test setup for component tests — extends Vitest's expect
// with jest-dom matchers (toBeInTheDocument, toBeDisabled, ...), and unmounts
// rendered components between tests (RTL auto-cleanup needs Vitest globals,
// which this project keeps off).
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
