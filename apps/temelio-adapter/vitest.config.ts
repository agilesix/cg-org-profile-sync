import { defineConfig } from "vitest/config";

/**
 * The adapter's own suite.
 *
 * The other three apps have no test harness — their logic lives in
 * `@cg-link/org-sync`, which has one. This app is the exception: the mapping
 * between Temelio's records and `Organization` is real behaviour that belongs
 * nowhere else, because nothing outside this adapter knows Temelio's shape.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
