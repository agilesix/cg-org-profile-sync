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

import type { FrameLocator, Page } from "@playwright/test";
import { ADMIN_EMAIL, PORTAL_ORIGIN, TEMELIO_ORIGIN } from "../env.js";
import { connect, connectInFrame, expect, openWidget, test } from "../fixtures.js";
import { FUNDERHUB_ORG_ID, PORTAL_ORG_ID, TEMELIO_ORG_ID } from "@cg-link/seed";

const SHOTS = "../docs/screenshots";

// Wide enough for three columns without a horizontal scrollbar, and short
// enough that a modal is not lost in whitespace.
test.use({ viewport: { width: 1280, height: 900 } });

/**
 * Screenshot options for a shot that has to show a whole page.
 *
 * `fullPage` rather than a taller viewport, because the right height is not a
 * constant: the grid grew past the fold when #1190-T6 took the comparison to
 * seven fields, and a fixed number would need revisiting at eight. This
 * measures the content instead — and leaves the shots that frame a modal at
 * the viewport, where a taller window would only add grey.
 */
const WHOLE_PAGE = { fullPage: true } as const;

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
  await page.screenshot({ path: `${SHOTS}/3-compare.png`, ...WHOLE_PAGE });

  await page.getByTestId("pick-addresses.primary-portal").click();
  await expect(page.getByTestId("target-temelio")).toBeChecked();
  await page.getByTestId("sync").click();
  await expect(page.getByTestId("sync-result-temelio")).toHaveAttribute("data-ok", "true");
  await expect(page.getByTestId("row-addresses.primary")).toHaveAttribute("data-status", "agree");
  await page.screenshot({ path: `${SHOTS}/4-synced.png`, ...WHOLE_PAGE });

  // The field a system cannot store, said before anything is sent: the button
  // greys out and the line above it names the system and the field.
  await page.getByTestId("pick-socials.website-portal").click();
  await expect(page.getByTestId("blocked-funderhub")).toBeVisible();
  await expect(page.getByTestId("sync")).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/5-blocked.png`, ...WHOLE_PAGE });

  // And the far side of the push, on the adapter's own page.
  await page.goto(TEMELIO_ORIGIN);
  await expect(page.getByTestId("mode")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/6-adapter.png`, ...WHOLE_PAGE });
});

test("capture the profile page, the overlay, and a pull", async ({ page }) => {
  // The screen a nonprofit keeps their profile on, which is where the demo
  // now starts. Taken before anything is linked, so it is the seed.
  await page.goto(`${PORTAL_ORIGIN}/orgs/${PORTAL_ORG_ID}`);
  await expect(page.getByTestId("profile")).toHaveAttribute("data-ready", "true");
  await page.screenshot({ path: `${SHOTS}/9-profile.png`, ...WHOLE_PAGE });

  // The widget over that page, rather than in a tab of its own: the shape the
  // demo actually ships in, and the one the README leads with.
  const widget = await openLinkOver(page);

  await connectInFrame(page, widget, "portal", ADMIN_EMAIL, PORTAL_ORG_ID);
  await connectInFrame(page, widget, "funderhub", ADMIN_EMAIL, FUNDERHUB_ORG_ID);
  await connectInFrame(page, widget, "temelio", ADMIN_EMAIL, TEMELIO_ORG_ID);

  await expect(widget.getByTestId("grid")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/7-embedded.png` });

  // A pull: another system's value coming into the page you are standing on,
  // with the host as the only target it could possibly reach.
  await widget.getByTestId("pick-addresses.primary-funderhub").click();
  await expect(widget.getByTestId("direction")).toHaveAttribute("data-direction", "pull");
  await page.screenshot({ path: `${SHOTS}/8-pull.png` });
});

/** The widget, addressed inside the overlay the loader mounted. */
function widgetIn(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="cg-link-frame"]');
}

/** Open the widget over the profile page already loaded, and wait for it. */
async function openLinkOver(page: Page): Promise<FrameLocator> {
  await page.getByTestId("open-link").click();

  const widget = widgetIn(page);

  await expect(widget.getByTestId("widget")).toHaveAttribute("data-ready", "true");

  return widget;
}
