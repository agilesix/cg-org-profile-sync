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

import {
  AGILE_SIX_EIN,
  FUNDERHUB_ORG_ID,
  FUNDERHUB_SEEDS,
  PORTAL_ORG_ID,
  PORTAL_SEED,
  PORTAL_SEEDS,
  TEMELIO_ORG_ID,
} from "@cg-link/seed";
import { ADMIN_EMAIL, PORTAL_ONLY_EMAIL } from "../env.js";
import {
  connect,
  connectExpectingDenial,
  expect,
  openWidget,
  signInVia,
  test,
} from "../fixtures.js";

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

  // The three real systems are choosable; the rest are named and are not.
  await expect(page.getByTestId("pick-system-portal")).toBeVisible();
  await expect(page.getByTestId("pick-system-funderhub")).toBeVisible();
  await expect(page.getByTestId("pick-system-temelio")).toBeVisible();
  await expect(page.getByTestId("system-soon-simpler-grants")).toContainText("Coming soon");
  await expect(page.getByTestId("pick-system-simpler-grants")).toHaveCount(0);
});

test("connecting one system shows its values and says the other is not connected", async ({
  page,
}) => {
  await openWidget(page);
  await connect(page, "portal", ADMIN_EMAIL, PORTAL_ORG_ID);

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
  await connect(page, "portal", PORTAL_ONLY_EMAIL, PORTAL_ORG_ID);
  await connectExpectingDenial(page, "funderhub", PORTAL_ONLY_EMAIL);

  await expect(page.getByTestId("connected-portal")).toBeVisible();
  await expect(page.getByTestId("chip-denied-funderhub")).toContainText(
    "No organization here for that account",
  );
});

test("a refusal leaves the comparison showing the system that did answer", async ({ page }) => {
  await openWidget(page);
  await connect(page, "portal", PORTAL_ONLY_EMAIL, PORTAL_ORG_ID);
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

  // Back on the widget, and the modal reopens on the step that is actually
  // outstanding: which organization. It does NOT ask them to sign in again to
  // a system that has just signed them in.
  await expect(page.getByTestId(`org-${PORTAL_ORG_ID}`)).toBeVisible();
  await expect(page.getByTestId("continue-with-google")).toHaveCount(0);

  await page.getByTestId(`org-${PORTAL_ORG_ID}`).click();
  await page.getByTestId("confirm-org").click();

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

/**
 * Choosing an organization, and being held to it afterwards.
 *
 * The lock is the rule that decides which record a later `PATCH` lands on, so
 * it is worth driving in a browser and not only in `selectableOrgs`' unit
 * tests: those prove the rule, these prove the widget actually applies it to
 * the list a real system returned.
 */

test("the organization step waits for a pick, and a second click takes it back", async ({
  page,
}) => {
  await openWidget(page);
  await signInVia(page, "portal", ADMIN_EMAIL);

  // Every organization GrantPortal grants the admin, and nothing chosen yet.
  await expect(page.getByTestId("confirm-org")).toBeDisabled();
  for (const seed of PORTAL_SEEDS) {
    await expect(page.getByTestId(`org-${seed.id}`)).toBeVisible();
  }

  await page.getByTestId(`org-${PORTAL_ORG_ID}`).click();
  await expect(page.getByTestId("confirm-org")).toBeEnabled();

  // Clicking the same row again unpicks it — one organization at a time, and
  // changing your mind should not need the modal closed and reopened.
  await page.getByTestId(`org-${PORTAL_ORG_ID}`).click();
  await expect(page.getByTestId("confirm-org")).toBeDisabled();
});

test("linking shows the banner and names the organization in the header", async ({ page }) => {
  await openWidget(page);
  await connect(page, "portal", ADMIN_EMAIL, PORTAL_ORG_ID);

  await expect(page.getByTestId("linked-banner")).toContainText("GrantPortal linked");
  await expect(page.getByTestId("linked-org")).toContainText(PORTAL_SEED.name);
  await expect(page.getByTestId("linked-org")).toContainText(AGILE_SIX_EIN);

  // Dismissible, because it is an acknowledgement and not a state.
  await page.getByTestId("dismiss-banner").click();
  await expect(page.getByTestId("linked-banner")).toHaveCount(0);
});

test("the second system is locked to the organization already linked", async ({ page }) => {
  await openWidget(page);
  await connect(page, "portal", ADMIN_EMAIL, PORTAL_ORG_ID);

  await signInVia(page, "funderhub", ADMIN_EMAIL);

  // FunderHub holds all three organizations under its own ids, but only the
  // one sharing an EIN with what is already linked may be chosen — and since
  // that leaves exactly one choice, the widget has made it.
  const matching = page.getByTestId(`org-${FUNDERHUB_ORG_ID}`);
  await expect(matching).toHaveAttribute("aria-pressed", "true");
  await expect(matching).toBeEnabled();
  await expect(page.getByTestId("confirm-org")).toBeEnabled();

  // Whatever else FunderHub holds — the count is the seeds' business, not this
  // spec's, and pinning it here made the spec fail the moment FunderHub
  // stopped holding an organization GrantPortal does.
  const others = FUNDERHUB_SEEDS.filter((seed) => seed.id !== FUNDERHUB_ORG_ID);
  expect(others.length).toBeGreaterThan(0);

  for (const seed of others) {
    const row = page.getByTestId(`org-${seed.id}`);

    // Disabled, and still on screen saying why: a row that vanished would
    // leave someone hunting for an organization the system really does hold.
    await expect(row).toBeDisabled();
    await expect(row).toContainText("Different organization");
  }
});

test("a vendor behind an adapter signs in like any other system, and locks to the same organization", async ({
  page,
}) => {
  await openWidget(page);
  await connect(page, "portal", ADMIN_EMAIL, PORTAL_ORG_ID);

  await signInVia(page, "temelio", ADMIN_EMAIL);

  // Temelio is not a CommonGrants-native system at all — it is a vendor with
  // its own API, behind an adapter. None of that is visible here: the same
  // sign-in, the same organization step, the same EIN lock against what is
  // already linked. That indistinguishability is the point of the adapter.
  const matching = page.getByTestId(`org-${TEMELIO_ORG_ID}`);
  await expect(matching).toHaveAttribute("aria-pressed", "true");
  await expect(matching).toBeEnabled();

  await page.getByTestId("confirm-org").click();
  await expect(page.getByTestId("connected-temelio")).toBeVisible();

  // And its column is in the grid, holding the website only it has.
  await expect(page.getByTestId("grid")).toBeVisible();
  await expect(page.getByTestId("cell-socials.website-temelio")).toContainText("agile6.com");
});

test("the adapter refuses someone it grants nothing, exactly as a native system does", async ({
  page,
}) => {
  await openWidget(page);
  await connect(page, "portal", ADMIN_EMAIL, PORTAL_ORG_ID);

  // The same beat FunderHub plays above, from a system whose records we do not
  // own. The adapter grants the allowlist to the demo's admin and nothing to
  // anybody else, so this person is turned away at Temelio's own door rather
  // than by Link deciding on its behalf.
  await connectExpectingDenial(page, "temelio", PORTAL_ONLY_EMAIL);
});

test("closing the modal before choosing leaves the system signed in, not linked", async ({
  page,
}) => {
  await openWidget(page);
  await signInVia(page, "portal", ADMIN_EMAIL);

  // Signed in, org step open, nothing chosen — then they close it.
  await expect(page.getByTestId("confirm-org")).toBeVisible();
  await page.getByTestId("close-modal").click();

  // A token is not a link. Claiming "Linked" here would promise an
  // organization the widget has not got, so the chip says what is actually
  // outstanding and the grid stays away.
  await expect(page.getByTestId("connected-portal")).toHaveCount(0);
  await expect(page.getByTestId("finish-portal")).toBeVisible();
  await expect(page.getByTestId("nothing-linked")).toBeVisible();

  // And there is a way back that does not make them sign in again.
  await page.getByTestId("finish-portal").click();
  await expect(page.getByTestId(`org-${PORTAL_ORG_ID}`)).toBeVisible();
  await expect(page.getByTestId("continue-with-google")).toHaveCount(0);

  await page.getByTestId(`org-${PORTAL_ORG_ID}`).click();
  await page.getByTestId("confirm-org").click();

  await expect(page.getByTestId("connected-portal")).toBeVisible();
  await expect(page.getByTestId("linked-org")).toContainText(AGILE_SIX_EIN);
});
