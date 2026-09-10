/**
 * The widget itself, driven in a browser against the two running systems.
 *
 * The API specs already prove the data moves; these prove a person can make it
 * move. That is a different claim, and it is the one the demo is judged on:
 * the drift is visible without reading JSON, one click chooses the correct
 * value, and the sentence a system returns when it declines a field reaches
 * the screen instead of being swallowed.
 *
 * Selectors are `data-testid` throughout, so restyling the grid cannot turn
 * into a red suite. The reset fixture is automatic, so each test starts from
 * the seed even though none of them ask for `api`.
 */

import { AGILE_SIX_EIN, FUNDERHUB_SEED, PORTAL_SEED } from "@cg-link/seed";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures.js";

/**
 * A seed value the assertions below are meaningless without.
 *
 * `toContainText("")` passes against anything, so a seed that quietly lost its
 * website would turn the website spec into a test of nothing. Throwing at
 * import time fails the whole file with the reason instead — the same trap
 * `fixtures.ts:valueHeldBy` exists to close, one level up.
 */
function required(value: string | undefined, what: string): string {
  if (!value) {
    throw new Error(`the seed no longer carries ${what}, so this spec cannot assert on it`);
  }

  return value;
}

const PORTAL_ADDRESS = PORTAL_SEED.addresses?.primary;
const PORTAL_STREET2 = required(PORTAL_ADDRESS?.street2, "portal's suite number");
const PORTAL_WEBSITE = required(PORTAL_SEED.socials?.website, "portal's website");
const FUNDERHUB_STREET2 = required(
  FUNDERHUB_SEED.addresses?.primary?.street2,
  "funderhub's suite number",
);

/**
 * Open the widget and wait for the browser to have taken it over.
 *
 * The page is server-rendered, so every button exists — and is clickable —
 * before any handler is attached. `data-ready` is set on mount, so waiting for
 * it is the difference between a click that selects a value and a click that
 * quietly does nothing.
 */
async function openWidget(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("widget")).toHaveAttribute("data-ready", "true");
}

test("the grid opens on the seeded org, with the address row marked as the disagreement", async ({
  page,
}) => {
  await openWidget(page);

  await expect(page.getByTestId("ein")).toHaveValue(AGILE_SIX_EIN);

  // One column per configured system, named as the registry names it.
  await expect(page.getByTestId("source-portal")).toContainText("GrantPortal");
  await expect(page.getByTestId("source-funderhub")).toContainText("FunderHub");

  // The one row that differs, and the three that do not.
  await expect(page.getByTestId("row-addresses.primary")).toHaveAttribute("data-status", "differs");
  await expect(page.getByTestId("row-name")).toHaveAttribute("data-status", "agree");
  await expect(page.getByTestId("row-identifiers.org:us:ein.id")).toHaveAttribute(
    "data-status",
    "agree",
  );

  // Rendered as a line someone can read, not as a JSON blob.
  await expect(page.getByTestId("cell-addresses.primary-portal")).toContainText(
    [
      PORTAL_ADDRESS?.street1,
      PORTAL_STREET2,
      `${PORTAL_ADDRESS?.city}, ${PORTAL_ADDRESS?.stateOrProvince}`,
      PORTAL_ADDRESS?.postalCode,
    ].join(", "),
  );
  await expect(page.getByTestId("cell-addresses.primary-funderhub")).toContainText(
    FUNDERHUB_STREET2,
  );

  // FunderHub does not model socials at all. A field one system holds and the
  // other has never heard of has to read as a gap, not as a conflict.
  await expect(page.getByTestId("row-socials.website")).toHaveAttribute("data-status", "agree");
  await expect(page.getByTestId("cell-socials.website-funderhub")).toHaveAttribute(
    "data-held",
    "false",
  );

  // Nothing is chosen yet, so there is nothing to send.
  await expect(page.getByTestId("prompt")).toBeVisible();
  await expect(page.getByTestId("sync")).toBeHidden();
});

test("choosing portal's address and syncing turns the row from differs to agree", async ({
  page,
}) => {
  await openWidget(page);

  const row = page.getByTestId("row-addresses.primary");
  await expect(row).toHaveAttribute("data-status", "differs");

  await page.getByTestId("pick-addresses.primary-portal").click();

  // The pick is visible in the grid and echoed in the panel, and every other
  // system that holds a record is offered as a target.
  await expect(page.getByTestId("cell-addresses.primary-portal")).toHaveAttribute(
    "data-selected",
    "true",
  );
  await expect(page.getByTestId("selection")).toContainText(PORTAL_STREET2);
  await expect(page.getByTestId("selection")).toContainText("GrantPortal");
  await expect(page.getByTestId("target-funderhub")).toBeChecked();

  // The source of the value is never a target — it already holds it.
  await expect(page.getByTestId("target-portal")).toHaveCount(0);

  await page.getByTestId("sync").click();

  const result = page.getByTestId("sync-result-funderhub");
  await expect(result).toHaveAttribute("data-ok", "true");

  // A result line is only published once the grid behind it has been re-read,
  // and a re-read that failed would say so here. Without this the next two
  // assertions could be describing a pre-sync paint.
  await expect(page.getByTestId("problem")).toHaveCount(0);

  await expect(row).toHaveAttribute("data-status", "agree");
  await expect(page.getByTestId("cell-addresses.primary-funderhub")).toContainText(PORTAL_STREET2);
});

test("pushing portal's website reports what funderhub declined, and the row is unchanged", async ({
  page,
}) => {
  await openWidget(page);

  await page.getByTestId("pick-socials.website-portal").click();
  await page.getByTestId("sync").click();

  // Accepted, not rejected: FunderHub applied what it could and said what it
  // dropped. That sentence is the only place the sender learns the value went
  // no further, so it has to reach the screen verbatim.
  const result = page.getByTestId("sync-result-funderhub");
  await expect(result).toHaveAttribute("data-ok", "true");
  await expect(result).toContainText("does not store");
  await expect(result).toContainText("socials");

  // "The row is unchanged" is exactly what a failed re-read would also show,
  // so rule that out before claiming it.
  await expect(page.getByTestId("problem")).toHaveCount(0);

  // And the grid says the same thing: portal still holds the website, and
  // funderhub still holds nothing.
  await expect(page.getByTestId("cell-socials.website-portal")).toContainText(PORTAL_WEBSITE);
  await expect(page.getByTestId("cell-socials.website-funderhub")).toHaveAttribute(
    "data-held",
    "false",
  );
  await expect(page.getByTestId("row-socials.website")).toHaveAttribute("data-status", "agree");
});

test("looking up a different EIN drops the pick rather than carrying it over", async ({ page }) => {
  await openWidget(page);

  await page.getByTestId("pick-addresses.primary-portal").click();
  await expect(page.getByTestId("selection")).toBeVisible();

  await page.getByTestId("ein").fill("000000000");
  await page.getByTestId("look-up").click();

  // Neither system holds this org, so every column says so and the grid still
  // renders — and the value picked for the *previous* org is gone, because
  // syncing it now would write one organization's address onto another.
  await expect(page.getByTestId("source-note-portal")).toBeVisible();
  await expect(page.getByTestId("source-note-funderhub")).toBeVisible();
  await expect(page.getByTestId("grid")).toBeVisible();
  await expect(page.getByTestId("selection")).toHaveCount(0);
  await expect(page.getByTestId("prompt")).toBeVisible();
});
