/**
 * The whole Plaid-shaped walk, once, in the order a person actually does it.
 *
 * The other browser specs each pin one beat — being refused, a blocked popup,
 * the lock on a second system. This one is the joined-up version: open on
 * nothing, pick a system from a list that looks like a network, sign in to
 * that system's own window, choose an organization, and come back with two
 * systems' copies side by side. If the demo works, this spec passes; if this
 * spec fails, the demo is broken, which is the only thing it exists to say.
 *
 * It ends on the beat that needs the seeds to disagree: an organization
 * GrantPortal knows and FunderHub has never heard of, which is what the
 * organization step's "no organization with that EIN" is for.
 */

import { AGILE_SIX_EIN, FUNDERHUB_ORG_ID, PORTAL_ORG_ID, PORTAL_SEED } from "@cg-link/seed";
import { ADMIN_EMAIL, PORTAL_ONLY_ORG } from "../env.js";
import { connect, expect, openWidget, signInVia, test } from "../fixtures.js";

/** Every system the picker names but this demo cannot connect. */
const COMING_SOON = ["simpler-grants", "fluxx", "submittable", "foundant"] as const;

test("linking two systems, from an empty widget to a comparison", async ({ page }) => {
  await openWidget(page);

  // One button. No systems, no fields, no grid: Link holds no credentials, so
  // there is nothing it could have read yet.
  await expect(page.getByTestId("link-system")).toBeVisible();
  await expect(page.getByTestId("nothing-linked")).toBeVisible();
  await expect(page.getByTestId("grid")).toHaveCount(0);

  await page.getByTestId("link-system").click();

  // Seven systems: the three this demo runs, and four it only names.
  await expect(page.getByTestId("pick-system-portal")).toBeVisible();
  await expect(page.getByTestId("pick-system-funderhub")).toBeVisible();
  await expect(page.getByTestId("pick-system-temelio")).toBeVisible();

  for (const id of COMING_SOON) {
    await expect(page.getByTestId(`system-soon-${id}`)).toContainText("Coming soon");
    // Named, not offered — there is no control to click.
    await expect(page.getByTestId(`pick-system-${id}`)).toHaveCount(0);
  }

  // A stub row goes nowhere: clicking it leaves the picker exactly as it was.
  await page.getByTestId("system-soon-simpler-grants").click();
  await expect(page.getByTestId("pick-system-portal")).toBeVisible();
  await expect(page.getByTestId("continue-with-google")).toHaveCount(0);

  await signInVia(page, "portal", ADMIN_EMAIL);

  // Three organizations, because that is what GrantPortal says this person may
  // act for — and nothing is chosen for them.
  await expect(page.getByTestId("confirm-org")).toBeDisabled();
  await expect(page.getByTestId(`org-${PORTAL_ORG_ID}`)).toBeVisible();

  await page.getByTestId(`org-${PORTAL_ORG_ID}`).click();
  await expect(page.getByTestId("confirm-org")).toBeEnabled();
  await page.getByTestId("confirm-org").click();

  // Linked: the modal is gone, the banner says which system, and the header
  // names the organization everything from here is about.
  await expect(page.getByTestId("link-modal")).toBeHidden();
  await expect(page.getByTestId("linked-banner")).toContainText("GrantPortal linked");
  await expect(page.getByTestId("linked-org")).toContainText(PORTAL_SEED.name);
  await expect(page.getByTestId("linked-org")).toContainText(AGILE_SIX_EIN);
  await expect(page.getByTestId("grid")).toContainText(PORTAL_SEED.name);

  // The second system. The button is still there, because linking one is not
  // the end of anything.
  await signInVia(page, "funderhub", ADMIN_EMAIL);

  // Held to what is already linked. Asserted here rather than left to the
  // `connect` helper, which clicks a row only when it is not already picked —
  // so delegating would have passed whether or not FunderHub pre-selected
  // anything, and this is the beat of the second connect worth proving.
  const matching = page.getByTestId(`org-${FUNDERHUB_ORG_ID}`);
  await expect(matching).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("confirm-org")).toBeEnabled();
  await page.getByTestId("confirm-org").click();

  // Both columns, and the disagreement the demo turns on.
  await expect(page.getByTestId("connected-portal")).toBeVisible();
  await expect(page.getByTestId("connected-funderhub")).toBeVisible();
  await expect(page.getByTestId("row-addresses.primary")).toHaveAttribute("data-status", "differs");

  // Nothing went wrong on the way.
  await expect(page.getByTestId("problem")).toHaveCount(0);
});

test("a system that has never heard of the linked organization says so", async ({ page }) => {
  await openWidget(page);

  // Link the one organization GrantPortal holds and FunderHub does not.
  await connect(page, "portal", ADMIN_EMAIL, PORTAL_ONLY_ORG.id);
  await expect(page.getByTestId("linked-org")).toContainText(PORTAL_ONLY_ORG.name);

  await signInVia(page, "funderhub", ADMIN_EMAIL);

  // FunderHub signed them in perfectly well — this is not a refusal. It simply
  // holds no record of the organization they linked, so there is nothing on
  // its list that could be chosen.
  await expect(page.getByTestId("no-matching-org")).toContainText(PORTAL_ONLY_ORG.ein);
  await expect(page.getByTestId("no-matching-org")).toContainText("FunderHub");
  await expect(page.getByTestId("confirm-org")).toHaveCount(0);

  await page.getByTestId("close-no-match").click();

  // And the widget carries on: GrantPortal's copy is still worth showing, and
  // FunderHub's column says it has no record rather than looking like a system
  // that agrees.
  await expect(page.getByTestId("link-modal")).toBeHidden();
  await expect(page.getByTestId("grid")).toContainText(PORTAL_ONLY_ORG.name);
  await expect(page.getByTestId("source-funderhub")).toHaveAttribute("data-state", "empty");
  await expect(page.getByTestId("problem")).toHaveCount(0);
});
