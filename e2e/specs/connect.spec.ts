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

test("the widget opens on the systems it can talk to, with nothing connected", async ({ page }) => {
  await openWidget(page);

  // Both systems offered, neither connected, and no grid — Link has no
  // credentials of its own, so there is nothing it could have read yet.
  await expect(page.getByTestId("connect-portal")).toBeVisible();
  await expect(page.getByTestId("connect-funderhub")).toBeVisible();
  await expect(page.getByTestId("nothing-connected")).toBeVisible();
});

test("connecting one system shows its values and says the other is not connected", async ({
  page,
}) => {
  await openWidget(page);
  await connect(page, "portal", ADMIN_EMAIL);

  // GrantPortal's column fills in; FunderHub's says why it is empty rather
  // than looking like a system that agrees.
  await expect(page.getByTestId("connected-portal")).toBeVisible();
  await expect(page.getByTestId("connect-funderhub")).toBeVisible();
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
  await expect(page.getByTestId("denied-funderhub")).toContainText("No access on this system");
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
