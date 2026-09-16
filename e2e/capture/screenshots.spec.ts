/**
 * The screenshots the README and a pull request body use.
 *
 * Not part of `pnpm e2e`. It lives under its own config so the normal suite
 * stays about behaviour, and so nobody has to capture these by hand — they go
 * stale every time the widget changes, and a stale screenshot of a demo is
 * worse than none, because it is what a reader believes over the text.
 *
 * Run: `pnpm --filter @cg-link/e2e run capture`
 */

import { ADMIN_EMAIL, TEMELIO_ORIGIN } from "../env.js";
import { connect, expect, openWidget, test } from "../fixtures.js";
import { FUNDERHUB_ORG_ID, PORTAL_ORG_ID, TEMELIO_ORG_ID } from "@cg-link/seed";

const SHOTS = "../docs/screenshots";

// Wide enough for three columns without a horizontal scrollbar, and short
// enough that the interesting part is not lost in whitespace.
test.use({ viewport: { width: 1280, height: 900 } });

test("capture the picker, the grid, a sync, and the adapter's own page", async ({ page }) => {
  await openWidget(page);
  await page.getByTestId("link-system").click();
  await expect(page.getByTestId("pick-system-temelio")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/1-picker.png` });

  // Escape the modal so the shot below is the grid rather than an overlay.
  await page.keyboard.press("Escape");
  await connect(page, "portal", ADMIN_EMAIL, PORTAL_ORG_ID);

  // The organization step, taken on the second system: this is where the lock
  // to the already-linked organization is visible.
  await page.getByTestId("link-system").click();
  await page.getByTestId("pick-system-funderhub").click();
  const popup = page.waitForEvent("popup");
  await page.getByTestId("continue-with-google").click();
  const signIn = await popup;
  await signIn.getByLabel("Email").fill(ADMIN_EMAIL);
  await signIn.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByTestId(`org-${FUNDERHUB_ORG_ID}`)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/2-organization.png` });

  await page.getByTestId("confirm-org").click();
  await connect(page, "temelio", ADMIN_EMAIL, TEMELIO_ORG_ID);

  await expect(page.getByTestId("grid")).toBeVisible();
  await expect(page.getByTestId("row-addresses.primary")).toHaveAttribute("data-status", "differs");
  await page.screenshot({ path: `${SHOTS}/3-compare.png` });

  await page.getByTestId("pick-addresses.primary-portal").click();
  await expect(page.getByTestId("target-temelio")).toBeChecked();
  await page.getByTestId("sync").click();
  await expect(page.getByTestId("sync-result-temelio")).toHaveAttribute("data-ok", "true");
  await expect(page.getByTestId("row-addresses.primary")).toHaveAttribute("data-status", "agree");
  await page.screenshot({ path: `${SHOTS}/4-synced.png` });

  // The field a system cannot store: accepted, dropped, and said out loud.
  await page.getByTestId("pick-socials.website-portal").click();
  await page.getByTestId("sync").click();
  await expect(page.getByTestId("sync-result-funderhub")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/5-declined.png` });

  // And the far side of the push, on the adapter's own page.
  await page.goto(TEMELIO_ORIGIN);
  await expect(page.getByTestId("mode")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/6-adapter.png` });
});
