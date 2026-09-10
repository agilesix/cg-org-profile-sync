import { defineConfig, devices } from "@playwright/test";
import { FUNDERHUB_ORIGIN, LINK_ORIGIN, PORTAL_ORIGIN } from "./env.js";

const isCI = Boolean(process.env.CI);

/**
 * Boot the two systems and the widget, then run the suite against them.
 *
 * This is the only test in the repo that proves the three apps actually
 * exchange data — the Vitest suites stub the transport, so nothing else
 * catches a route that is wired up wrong. That is worth the cost of starting
 * real dev servers.
 *
 * Serial on purpose. Both systems hold their profiles in memory and every spec
 * resets them, so two workers would be resetting each other's fixtures
 * mid-test. Parallelism would need a seed namespace per worker, which is more
 * machinery than a four-field demo justifies.
 */
export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? "list" : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: LINK_ORIGIN,
    trace: "on-first-retry",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  /**
   * Each app's own dev server, waited for at its root page.
   *
   * The root page rather than an API route because Vite compiles on demand:
   * the root is the one URL that answers as soon as the server is listening,
   * and the reset fixture absorbs the compile of everything else.
   *
   * `reuseExistingServer` locally means `pnpm e2e` joins a `pnpm dev` that is
   * already up instead of failing on the ports, which are `strictPort`.
   *
   * The trade-off is that Playwright cannot tell whose server it joined. A
   * `pnpm dev` left running from an earlier session serves stale code, and a
   * `pnpm dev` in a second checkout of this repo — a parallel git worktree,
   * say — serves *another branch's* code on the same ports, so the suite
   * quietly reports on work that is not in front of you. If a spec passes or
   * fails in a way the source does not explain, check what is on 5173/5174
   * before believing it.
   */
  webServer: [
    {
      command: "pnpm --filter @cg-link/portal dev",
      url: PORTAL_ORIGIN,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "pnpm --filter @cg-link/funderhub dev",
      url: FUNDERHUB_ORIGIN,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "pnpm --filter @cg-link/link dev",
      url: LINK_ORIGIN,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
