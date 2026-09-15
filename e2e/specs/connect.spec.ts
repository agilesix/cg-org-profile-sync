/**
 * Signing in to each system, and being turned away by one.
 *
 * The other browser spec proves the widget can move data once it is connected.
 * This one is about getting connected at all — and, more to the point, about
 * not getting connected: a person granted an organization on GrantPortal and
 * nothing on FunderHub sees exactly that, one system at a time, because each
 * one decides for itself who may touch what.
 *
 * That is the claim the whole of #1188 exists to make, so it is worth a spec
 * that drives it in a browser rather than a fan-out test that stubs the far
 * end.
 */

import { PORTAL_SEED } from "@cg-link/seed";
import { ADMIN_EMAIL, PORTAL_ONLY_EMAIL } from "../env.js";
import { connect, connectExpectingDenial, expect, openWidget, test } from "../fixtures.js";

test("the widget opens on one button, with nothing linked", async ({ page }) => {
  await openWidget(page);

  // One control and no grid — Link has no credentials of its own, so there is
  // nothing it could have read yet, and nothing to show but the way in.
  await expect(page.getByTestId("link-system")).toBeVisible();
  await expect(page.getByTestId("nothing-linked")).toBeVisible();
  await expect(page.getByTestId("grid")).toHaveCount(0);
  await expect(page.getByTestId("link-modal")).toBeHidden();
});

test("the picker lists every system, and names the ones it cannot connect", async ({ page }) => {
  await openWidget(page);
  await page.getByTestId("link-system").click();

  await expect(page.getByTestId("link-modal")).toBeVisible();

  // The two real systems are choosable; the rest are named and are not.
  await expect(page.getByTestId("pick-system-portal")).toBeVisible();
  await expect(page.getByTestId("pick-system-funderhub")).toBeVisible();
  await expect(page.getByTestId("system-soon-temelio")).toContainText("Coming soon");
  await expect(page.getByTestId("pick-system-temelio")).toHaveCount(0);
});

test("connecting one system shows its values and says the other is not connected", async ({
  page,
}) => {
  await openWidget(page);
  await connect(page, "portal", ADMIN_EMAIL);

  // GrantPortal's column fills in; FunderHub's says why it is empty rather
  // than looking like a system that agrees.
  await expect(page.getByTestId("connected-portal")).toBeVisible();
  await expect(page.getByTestId("connected-funderhub")).toHaveCount(0);
  await expect(page.getByTestId("grid")).toContainText(PORTAL_SEED.name);
  await expect(page.getByTestId("grid")).toContainText("not connected");
});

test("a person with no grant on a system is refused by that system alone", async ({ page }) => {
  await openWidget(page);

  // The same person, two systems, two answers. GrantPortal knows them and
  // FunderHub does not, and FunderHub is the one that decides that.
  await connect(page, "portal", PORTAL_ONLY_EMAIL);
  await connectExpectingDenial(page, "funderhub", PORTAL_ONLY_EMAIL);

  await expect(page.getByTestId("connected-portal")).toBeVisible();
  await expect(page.getByTestId("chip-denied-funderhub")).toContainText(
    "No organization here for that account",
  );
});

test("a refusal leaves the comparison showing the system that did answer", async ({ page }) => {
  await openWidget(page);
  await connect(page, "portal", PORTAL_ONLY_EMAIL);
  await connectExpectingDenial(page, "funderhub", PORTAL_ONLY_EMAIL);

  const grid = page.getByTestId("grid");

  // Being refused by one system is not an error state for the widget: the
  // profile GrantPortal holds is still worth showing, and the address row —
  // the demo's disagreement — simply has nothing to disagree with.
  await expect(grid).toContainText(PORTAL_SEED.name);
  await expect(grid).toContainText(String(PORTAL_SEED.addresses?.primary?.street2));
  await expect(page.getByTestId("problem")).toHaveCount(0);
});

/**
 * The window the sign-in runs in, and what happens when it does not cooperate.
 *
 * Both paths below are the ones a person hits by accident — a popup blocker,
 * or closing the window mid-thought — and neither is reachable from the happy
 * path above. They are also the two places this flow can go quiet: a modal
 * spinning on a window that is gone, or a tab that comes back and forgets what
 * it was doing. Worth pinning rather than hand-checking once.
 */

test("closing the sign-in window without finishing returns to the button, and says so", async ({
  page,
}) => {
  await openWidget(page);
  await page.getByTestId("link-system").click();
  await page.getByTestId("pick-system-portal").click();

  // Armed before the click that opens it: the event fires immediately, and a
  // listener attached afterwards waits for a window that already exists.
  const popupPromise = page.waitForEvent("popup");
  await page.getByTestId("continue-with-google").click();
  const popup = await popupPromise;

  await expect(page.getByTestId("signing-in")).toBeVisible();

  await popup.close();

  // Not a refusal and not an error — they shut the window. The step offers the
  // button again rather than explaining something that did not happen.
  await expect(page.getByTestId("sign-in-note")).toBeVisible();
  await expect(page.getByTestId("continue-with-google")).toBeVisible();
  await expect(page.getByTestId("problem")).toHaveCount(0);
});

test("a blocked popup signs in through this tab instead, and comes back linked", async ({
  page,
}) => {
  // Stands in for a popup blocker. `addInitScript` runs before the page's own
  // scripts on every navigation, so the widget sees `window.open` fail the way
  // it would in a browser that refuses one.
  await page.addInitScript(() => {
    window.open = () => null;
  });

  await openWidget(page);
  await page.getByTestId("link-system").click();
  await page.getByTestId("pick-system-portal").click();
  await page.getByTestId("continue-with-google").click();

  // This tab went to GrantPortal rather than a popup.
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByRole("button", { name: "Submit" }).click();

  // Back on the widget, linked — and the modal does NOT reopen asking them to
  // sign in to a system that has just signed them in.
  await expect(page.getByTestId("connected-portal")).toBeVisible();
  await expect(page.getByTestId("link-modal")).toBeHidden();
  await expect(page.getByTestId("grid")).toContainText(PORTAL_SEED.name);
});

test("a blocked popup that ends in a refusal reopens the modal on the refusal", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.open = () => null;
  });

  await openWidget(page);
  await page.getByTestId("link-system").click();
  await page.getByTestId("pick-system-funderhub").click();
  await page.getByTestId("continue-with-google").click();

  await page.getByLabel("Email").fill(PORTAL_ONLY_EMAIL);
  await page.getByRole("button", { name: "Submit" }).click();

  // The answer arrived while this tab was away, so the modal has to reopen
  // holding it — otherwise being turned down looks like nothing happening.
  await expect(page.getByTestId("link-modal")).toBeVisible();
  await expect(page.getByTestId("denied-funderhub")).toBeVisible();
});
