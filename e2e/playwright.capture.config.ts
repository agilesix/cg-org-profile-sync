import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";

/**
 * The screenshot run, on the same four servers as the suite.
 *
 * A separate config rather than a spec in `specs/` so `pnpm e2e` stays a test
 * command: this one writes files into the repo, which is not something a test
 * run should ever do as a side effect.
 */
export default defineConfig({
  ...base,
  testDir: "./capture",
  retries: 0,
});
