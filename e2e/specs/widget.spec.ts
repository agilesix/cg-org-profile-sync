/**
 * The widget itself, driven in a browser against the running systems.
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

import {
  AGILE_SIX_EIN,
  FUNDERHUB_ORG_ID,
  FUNDERHUB_SEED,
  PORTAL_ORG_ID,
  PORTAL_SEED,
  TEMELIO_ORG_ID,
} from "@cg-link/seed";
import { DEMO_FIELDS } from "@cg-link/org-sync/utils";
import type { Page } from "@playwright/test";
import { connect, expect, openWidget, test } from "../fixtures.js";
import { ADMIN_EMAIL } from "../env.js";

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
const PORTAL_EMAIL = required(PORTAL_SEED.emails?.primary, "portal's email address");
const PORTAL_MISSION = required(PORTAL_SEED.mission, "portal's mission");
const PORTAL_PHONE = required(PORTAL_SEED.phones?.primary.number, "portal's phone number");

/**
 * Open the widget and sign in to both systems as the admin.
 *
 * Every test below is about the grid, and there is no grid until something is
 * connected — Link holds no credentials of its own. The tokens are obtained
 * through each portal's real flow rather than injected, so what these specs go
 * on to prove about reading and writing is something the systems allowed, not
 * something the fixture arranged.
 */
async function openConnected(page: Page): Promise<void> {
  await openWidget(page);
  await connect(page, "portal", ADMIN_EMAIL, PORTAL_ORG_ID);
  await connect(page, "funderhub", ADMIN_EMAIL, FUNDERHUB_ORG_ID);
}

/**
 * Sign in to all three systems.
 *
 * `openConnected` stops at two because most of the grid's beats are visible
 * with two columns. The tests using this one are about a value reaching the
 * vendor behind the adapter, so the third column has to be there.
 */
async function openAllThree(page: Page): Promise<void> {
  await openWidget(page);
  await connect(page, "portal", ADMIN_EMAIL, PORTAL_ORG_ID);
  await connect(page, "funderhub", ADMIN_EMAIL, FUNDERHUB_ORG_ID);
  await connect(page, "temelio", ADMIN_EMAIL, TEMELIO_ORG_ID);
}

test("the grid opens on the seeded org, with the address and email rows marked as the disagreements", async ({
  page,
}) => {
  await openConnected(page);

  // The organization is named in the header now, not typed into a field: it
  // was chosen in the modal, and one organization is linked at a time.
  await expect(page.getByTestId("linked-org")).toContainText(PORTAL_SEED.name);
  await expect(page.getByTestId("linked-org")).toContainText(AGILE_SIX_EIN);

  // One column per configured system, named as the registry names it.
  await expect(page.getByTestId("source-portal")).toContainText("GrantPortal");
  await expect(page.getByTestId("source-funderhub")).toContainText("FunderHub");

  // One row per compared field — counted off `DEMO_FIELDS` rather than
  // written as 7, since the library's promise is that adding a field to the
  // demo is one entry there and nothing else. Seven of them as of #1190-T6.
  await expect(page.locator('[data-testid^="row-"]')).toHaveCount(DEMO_FIELDS.length);

  // The ones that differ are the address and
  // the email. GrantPortal holds the current suite and the working mailbox;
  // FunderHub is a suite behind on one and pointing at a dead address on the
  // other, so neither system is simply the right one.
  await expect(page.getByTestId("row-addresses.primary")).toHaveAttribute("data-status", "differs");
  await expect(page.getByTestId("row-emails.primary")).toHaveAttribute("data-status", "differs");
  await expect(page.getByTestId("row-name")).toHaveAttribute("data-status", "agree");
  await expect(page.getByTestId("row-identifiers.org:us:ein.id")).toHaveAttribute(
    "data-status",
    "agree",
  );

  // Nothing was invented to make the phone drift, so it is the demo's example
  // of a field two systems simply agree about.
  await expect(page.getByTestId("row-phones.primary.number")).toHaveAttribute(
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

  // The mission is the same gap without the write refusal on top of it:
  // FunderHub can store one and simply never had it filled in.
  await expect(page.getByTestId("row-mission")).toHaveAttribute("data-status", "agree");
  await expect(page.getByTestId("cell-mission-funderhub")).toHaveAttribute("data-held", "false");

  // Nothing is chosen yet, so there is nothing to send.
  await expect(page.getByTestId("prompt")).toBeVisible();
  await expect(page.getByTestId("sync")).toBeHidden();
});

test("choosing portal's address and syncing turns the row from differs to agree", async ({
  page,
}) => {
  await openConnected(page);

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

  // Standalone there is no page to pull anything into, so every pick is a push
  // — and the panel says which copy is about to be overwritten rather than
  // leaving it to the word "sync".
  const direction = page.getByTestId("direction");

  await expect(direction).toHaveAttribute("data-direction", "push");
  await expect(direction).toContainText("Push Primary address from GrantPortal to FunderHub");

  // The source of the value is never a target — it already holds it.
  await expect(page.getByTestId("target-portal")).toHaveCount(0);

  await page.getByTestId("sync").click();

  const result = page.getByTestId("sync-result-funderhub");
  await expect(result).toHaveAttribute("data-ok", "true");
  await expect(result).toHaveAttribute("data-applied", "true");
  await expect(result).toContainText("pushed to");

  // A result line is only published once the grid behind it has been re-read,
  // and a re-read that failed would say so here. Without this the next two
  // assertions could be describing a pre-sync paint.
  await expect(page.getByTestId("problem")).toHaveCount(0);

  await expect(row).toHaveAttribute("data-status", "agree");
  await expect(page.getByTestId("cell-addresses.primary-funderhub")).toContainText(PORTAL_STREET2);
});

test("a vendor behind an adapter is offered as a target, and takes the push", async ({ page }) => {
  await openAllThree(page);

  const row = page.getByTestId("row-addresses.primary");
  await expect(row).toHaveAttribute("data-status", "differs");

  await page.getByTestId("pick-addresses.primary-portal").click();

  // Temelio is a checkbox like any other. Nothing on this screen says it is a
  // proxy over a vendor's own API rather than a system that speaks the
  // protocol, and nothing should.
  await expect(page.getByTestId("target-funderhub")).toBeChecked();
  await expect(page.getByTestId("target-temelio")).toBeChecked();

  await page.getByTestId("sync").click();

  await expect(page.getByTestId("sync-result-temelio")).toHaveAttribute("data-ok", "true");
  await expect(page.getByTestId("problem")).toHaveCount(0);

  // All three now hold the address the person chose.
  await expect(row).toHaveAttribute("data-status", "agree");
  await expect(page.getByTestId("cell-addresses.primary-temelio")).toContainText(PORTAL_STREET2);
});

test("pushing portal's email settles the disagreement at both other systems", async ({ page }) => {
  await openAllThree(page);

  // The second disagreement in the seed, and the one nobody staged: FunderHub
  // holds a mailbox that no longer routes anywhere, so here it is the outlier
  // rather than GrantPortal.
  const row = page.getByTestId("row-emails.primary");
  await expect(row).toHaveAttribute("data-status", "differs");
  await expect(page.getByTestId("cell-emails.primary-funderhub")).toContainText(
    required(FUNDERHUB_SEED.emails?.primary, "funderhub's email address"),
  );

  await page.getByTestId("pick-emails.primary-portal").click();
  await page.getByTestId("sync").click();

  await expect(page.getByTestId("sync-result-funderhub")).toHaveAttribute("data-ok", "true");
  await expect(page.getByTestId("problem")).toHaveCount(0);

  // Temelio already agreed with GrantPortal, so it is not offered as a target
  // — but the row can only agree once FunderHub has taken the value.
  await expect(row).toHaveAttribute("data-status", "agree");
  await expect(page.getByTestId("cell-emails.primary-funderhub")).toContainText(PORTAL_EMAIL);
});

test("pushing portal's mission fills the gap at funderhub", async ({ page }) => {
  await openAllThree(page);

  // A gap rather than a drift: FunderHub can store a mission and simply never
  // had one filled in, so the row reads agree before the push as well as
  // after. What changes is that a third system holds it.
  const row = page.getByTestId("row-mission");
  await expect(row).toHaveAttribute("data-status", "agree");
  await expect(page.getByTestId("cell-mission-funderhub")).toHaveAttribute("data-held", "false");

  await page.getByTestId("pick-mission-portal").click();
  await page.getByTestId("sync").click();

  await expect(page.getByTestId("sync-result-funderhub")).toHaveAttribute("data-ok", "true");

  // The cell, not the row's status: the row read `agree` before the push too,
  // so asserting it again afterwards would pass whether or not anything moved.
  // What changed is that FunderHub now holds a value where it held none.
  await expect(page.getByTestId("cell-mission-funderhub")).toContainText(PORTAL_MISSION);
  await expect(page.getByTestId("cell-mission-funderhub")).toHaveAttribute("data-held", "true");
});

test("the three fields #1190-T6 added all reach a vendor's own system from one Sync", async ({
  page,
}) => {
  await openAllThree(page);

  // The shape a presenter actually uses: several rows picked, one Sync. What
  // this can pin from a browser is that all three land at both targets and
  // none clobbers another on the way — which for Temelio means its adapter
  // folded three keys of one merge patch into the vendor's own call correctly.
  //
  // It cannot count the patches: the browser only ever sees Link's own
  // `/api/sync`, and the fan-out to each system happens server-side. That
  // "one PATCH per target, not one per field" claim is pinned where it is
  // visible — `api-sync.spec.ts` asserts two result rows for three fields, and
  // `client/fanout.test.ts` asserts it against a stubbed transport.
  await page.getByTestId("pick-mission-portal").click();
  await page.getByTestId("pick-emails.primary-portal").click();
  await page.getByTestId("pick-phones.primary.number-portal").click();

  // None of the three is in any system's `unwritableFields`, which is why they
  // were the three to add — so nothing is blocked and Sync stays live.
  await expect(page.getByTestId("blocked-funderhub")).toHaveCount(0);
  await expect(page.getByTestId("blocked-temelio")).toHaveCount(0);
  await expect(page.getByTestId("sync")).toBeEnabled();

  await page.getByTestId("sync").click();

  await expect(page.getByTestId("sync-result-funderhub")).toHaveAttribute("data-ok", "true");
  await expect(page.getByTestId("sync-result-temelio")).toHaveAttribute("data-ok", "true");
  await expect(page.getByTestId("problem")).toHaveCount(0);

  // And every one of the three is in the target's own column afterwards.
  await expect(page.getByTestId("cell-mission-funderhub")).toContainText(PORTAL_MISSION);
  await expect(page.getByTestId("cell-emails.primary-funderhub")).toContainText(PORTAL_EMAIL);
  await expect(page.getByTestId("cell-phones.primary.number-funderhub")).toContainText(
    PORTAL_PHONE,
  );
  await expect(page.getByTestId("cell-mission-temelio")).toContainText(PORTAL_MISSION);
  await expect(page.getByTestId("cell-emails.primary-temelio")).toContainText(PORTAL_EMAIL);
  await expect(page.getByTestId("cell-phones.primary.number-temelio")).toContainText(PORTAL_PHONE);

  for (const path of ["mission", "emails.primary", "phones.primary.number"]) {
    await expect(page.getByTestId(`row-${path}`)).toHaveAttribute("data-status", "agree");
  }
});

test("the grid is capped at a fixed height, and its headings stick when it scrolls", async ({
  page,
}) => {
  await openAllThree(page);

  const scroller = page.getByTestId("grid-scroller");

  // Seven fields against three systems fit inside the cap today, which is why
  // this does not assert that the grid is scrolling: it asserts the cap is
  // real and the grid is inside it. The scrolling case is pinned where it
  // actually happens — `embedded.spec.ts`, in an overlay that cannot grow.
  const capped = await scroller.evaluate((el) => {
    const max = getComputedStyle(el).maxHeight;

    return {
      max,
      maxPx: Number.parseFloat(max),
      height: el.clientHeight,
      overflows: el.scrollHeight > el.clientHeight,
    };
  });

  expect(capped.max, "the grid has no fixed height at all").not.toBe("none");
  expect(capped.height).toBeLessThanOrEqual(capped.maxPx);

  // Scrolled to the bottom whether or not there is anywhere to go. If the
  // comparison ever outgrows the cap this still holds, and the heading check
  // below is then doing real work rather than reading an unscrolled table.
  await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));

  const geometry = await scroller.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const rowOf = (path: string) =>
      el.querySelector(`[data-testid="row-${path}"]`)?.getBoundingClientRect();

    return {
      top: box.top,
      bottom: box.bottom,
      lastRowBottom: rowOf("phones.primary.number")?.bottom,
      headingTop: el.querySelector('[data-testid="source-temelio"]')?.getBoundingClientRect().top,
    };
  });

  // The last row is inside the box — reachable, by scrolling or because it
  // already fits. Geometry rather than visibility: a row scrolled out of a
  // container is still "visible" to Playwright.
  expect(geometry.lastRowBottom, "no phone row in the grid").toBeDefined();
  expect(geometry.lastRowBottom!).toBeLessThanOrEqual(geometry.bottom + 1);

  // And the heading is at the top of the box rather than scrolled away with
  // the rows, which is the point of making it sticky.
  expect(geometry.headingTop, "no Temelio column heading").toBeDefined();
  expect(Math.abs(geometry.headingTop! - geometry.top)).toBeLessThan(2);
});

test("pushing portal's website to funderhub is blocked before send", async ({ page }) => {
  await openConnected(page);

  await page.getByTestId("pick-socials.website-portal").click();

  // Said up front, not after the fact. Before #1191-T2 this was a click, a
  // request, and a line explaining that the field had gone nowhere — the
  // system got the last word about a change the person had already committed
  // to. Now the widget knows FunderHub will not keep `socials` and says so
  // while the button is still grey.
  const blocked = page.getByTestId("blocked-funderhub");
  await expect(blocked).toBeVisible();
  await expect(blocked).toContainText("FunderHub");
  await expect(blocked).toContainText("Website");
  await expect(page.getByTestId("sync")).toBeDisabled();

  // Nothing was sent, so there is no result line and nothing moved.
  await expect(page.getByTestId("sync-result-funderhub")).toHaveCount(0);
  await expect(page.getByTestId("cell-socials.website-portal")).toContainText(PORTAL_WEBSITE);
  await expect(page.getByTestId("cell-socials.website-funderhub")).toHaveAttribute(
    "data-held",
    "false",
  );

  // Either way out of it re-enables the button: drop the pick, or drop the
  // system that cannot take it.
  await page.getByTestId("unpick-socials.website").click();
  await expect(page.getByTestId("blocked-funderhub")).toHaveCount(0);

  await page.getByTestId("pick-socials.website-portal").click();
  await expect(page.getByTestId("sync")).toBeDisabled();

  await page.getByTestId("target-funderhub").uncheck();
  await expect(page.getByTestId("blocked-funderhub")).toHaveCount(0);
});

test("picking two rows sends them together, and each pick can be taken back", async ({ page }) => {
  await openWidget(page);
  await connect(page, "portal", ADMIN_EMAIL, PORTAL_ORG_ID);
  await connect(page, "funderhub", ADMIN_EMAIL, FUNDERHUB_ORG_ID);
  await connect(page, "temelio", ADMIN_EMAIL, TEMELIO_ORG_ID);

  const addressRow = page.getByTestId("row-addresses.primary");
  await expect(addressRow).toHaveAttribute("data-status", "differs");

  await page.getByTestId("pick-addresses.primary-portal").click();
  await page.getByTestId("pick-socials.website-portal").click();

  // Both picks stand at once, each on its own line.
  await expect(page.getByTestId("selected-addresses.primary")).toContainText(PORTAL_STREET2);
  await expect(page.getByTestId("selected-socials.website")).toContainText(PORTAL_WEBSITE);

  // Picking again in a row replaces that row's choice rather than adding to
  // it — otherwise the patch would carry two values for one field.
  await page.getByTestId("pick-addresses.primary-funderhub").click();
  await expect(page.getByTestId("selected-addresses.primary")).toContainText(FUNDERHUB_STREET2);
  await expect(page.getByTestId("cell-addresses.primary-portal")).toHaveAttribute(
    "data-selected",
    "false",
  );

  // Put it back, then prove a pick is removable.
  await page.getByTestId("pick-addresses.primary-portal").click();
  await page.getByTestId("unpick-socials.website").click();
  await expect(page.getByTestId("selected-socials.website")).toHaveCount(0);
  await expect(page.getByTestId("selected-addresses.primary")).toBeVisible();

  await page.getByTestId("pick-socials.website-portal").click();

  // FunderHub cannot take the website, so it has to come off the targets
  // before this can be sent at all — which is #1191-T2 doing its job inside a
  // spec that is about something else.
  await page.getByTestId("target-funderhub").uncheck();
  await expect(page.getByTestId("blocked-funderhub")).toHaveCount(0);

  await page.getByTestId("sync").click();

  // One result line, because both changes went to that target in one request.
  await expect(page.getByTestId("sync-result-temelio")).toHaveAttribute("data-ok", "true");
  await expect(page.getByTestId("sync-result-temelio")).toHaveAttribute("data-applied", "true");
  await expect(page.getByTestId("sync-result-funderhub")).toHaveCount(0);
  await expect(page.getByTestId("problem")).toHaveCount(0);

  // Both picks landed on Temelio, from the one click.
  await expect(page.getByTestId("cell-addresses.primary-temelio")).toContainText(PORTAL_STREET2);
  await expect(page.getByTestId("cell-socials.website-temelio")).toContainText(PORTAL_WEBSITE);
});

test("unchecking a target survives a later pick in another row", async ({ page }) => {
  await openConnected(page);

  await page.getByTestId("pick-addresses.primary-portal").click();
  await expect(page.getByTestId("target-funderhub")).toBeChecked();

  // Deliberately taken off the list.
  await page.getByTestId("target-funderhub").uncheck();
  await expect(page.getByTestId("sync")).toBeDisabled();

  // A pick in an unrelated row must not put it back. Re-checking here would
  // undo a decision on a click that had nothing to do with that system.
  await page.getByTestId("pick-socials.website-portal").click();
  await expect(page.getByTestId("target-funderhub")).not.toBeChecked();
  await expect(page.getByTestId("sync")).toBeDisabled();
});

test("the linked organization and both systems survive a reload", async ({ page }) => {
  await openConnected(page);

  await page.reload();
  await expect(page.getByTestId("widget")).toHaveAttribute("data-ready", "true");

  // Tokens and the linked organization both live in `sessionStorage`, so a
  // reload is not a fresh start — and it must not reopen the modal, which
  // would read as the link having come undone.
  await expect(page.getByTestId("linked-org")).toContainText(AGILE_SIX_EIN);
  await expect(page.getByTestId("connected-portal")).toBeVisible();
  await expect(page.getByTestId("connected-funderhub")).toBeVisible();
  await expect(page.getByTestId("link-modal")).toBeHidden();
  await expect(page.getByTestId("grid")).toContainText(PORTAL_SEED.name);
});
