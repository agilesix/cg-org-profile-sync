/**
 * Each system's own profile page, and the edit that starts the demo.
 *
 * The widget's specs all begin from the seed, so nothing else proves that a
 * change made *on a system* — by someone typing into that system's own form,
 * with no token and no Link involved — is what the comparison then reads. This
 * is the hop the demo opens with.
 */

import type { Page } from "@playwright/test";
import { FUNDERHUB_ORG_ID, PORTAL_ORG_ID, PORTAL_SEED } from "@cg-link/seed";
import { FUNDERHUB_ORIGIN, PORTAL_ORIGIN } from "../env.js";
import { expect, rowFor, test, valueHeldBy } from "../fixtures.js";

/** GrantPortal's profile page for the demo org. */
const PORTAL_PROFILE = `${PORTAL_ORIGIN}/orgs/${PORTAL_ORG_ID}`;

/**
 * Open a profile page and wait for the browser to have taken it over.
 *
 * The form is a plain `POST` and works without JavaScript, but the page is
 * server-rendered and SvelteKit's router hydrates over it — so a submit
 * clicked in that window starts a navigation the router then takes over
 * mid-flight, and the result is a save that occasionally goes missing.
 * `data-ready` is published on mount, the same way the widget does it.
 */
async function openProfile(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByTestId("profile")).toHaveAttribute("data-ready", "true");
}

test("an edit on GrantPortal's page is what Link's comparison then reads", async ({
  page,
  api,
}) => {
  await openProfile(page, PORTAL_PROFILE);

  await page.getByTestId("input-street2").fill("Suite 400");
  await page.getByTestId("save").click();

  // The system's own sentence, and the re-render showing what it stored.
  await expect(page.getByTestId("save-message")).toContainText("Change applied");
  await expect(page.getByTestId("input-street2")).toHaveValue("Suite 400");

  const row = rowFor(await api.compare(), "addresses.primary");

  expect(valueHeldBy(row, "portal")).toMatchObject({ street2: "Suite 400" });
  expect(row.status).toBe("differs");
});

test("a change the schema refuses shows the system's message and stores nothing", async ({
  page,
  api,
}) => {
  await openProfile(page, PORTAL_PROFILE);

  // An organization has to have a legal name, so emptying the box is a change
  // the system declines — the beat that proves the page is behind the same
  // rules as the route rather than writing whatever it is handed.
  await page.getByTestId("input-name").fill("");
  await page.getByTestId("save").click();

  await expect(page.getByTestId("save-message")).toContainText("invalid");
  await expect(page.getByTestId("input-name")).toHaveValue(PORTAL_SEED.name);

  const row = rowFor(await api.compare(), "name");

  expect(valueHeldBy(row, "portal")).toBe(PORTAL_SEED.name);
});

test("a reset puts the page back to the seed", async ({ page, request }) => {
  await openProfile(page, PORTAL_PROFILE);

  await page.getByTestId("input-street2").fill("Suite 400");
  await page.getByTestId("save").click();
  await expect(page.getByTestId("save-message")).toContainText("Change applied");

  await request.post(`${PORTAL_ORIGIN}/__test/reset`);
  await page.reload();

  await expect(page.getByTestId("input-street2")).toHaveValue("Suite 300");
});

test("FunderHub's page offers no website, because it does not store socials", async ({ page }) => {
  await openProfile(page, `${FUNDERHUB_ORIGIN}/orgs/${FUNDERHUB_ORG_ID}`);

  await expect(page.getByTestId("profile")).toBeVisible();
  await expect(page.getByTestId("input-website")).toHaveCount(0);

  // Asserted against the other system in the same spec, so this reads as a
  // difference between two configurations rather than as a missing field.
  await openProfile(page, PORTAL_PROFILE);

  await expect(page.getByTestId("input-website")).toHaveValue(PORTAL_SEED.socials?.website ?? "");
});

test("each system's landing page links to the seeded profile", async ({ page }) => {
  for (const origin of [PORTAL_ORIGIN, FUNDERHUB_ORIGIN]) {
    await page.goto(origin);
    await page.getByTestId("profile-link").click();

    await expect(page.getByTestId("profile")).toHaveAttribute("data-ready", "true");
    await expect(page.getByTestId("input-name")).toHaveValue(PORTAL_SEED.name);
  }
});
