/**
 * The widget as a host page sees it: an overlay iframe, and two messages back.
 *
 * Everything else in this suite drives Link standalone, which is not how a
 * nonprofit would ever meet it. Embedded is the shape the demo ships in, and
 * it is the shape with the parts that can only fail in a browser — a
 * `frame-ancestors` policy, a sign-in that has to leave the frame in a popup,
 * and a `postMessage` bridge whose two origin checks are the whole of its
 * security.
 *
 * The long spec at the end is the demo in one test: edit on GrantPortal, open
 * Link over that page, push the change to FunderHub, close, and find it on
 * FunderHub's own screen.
 */

import type { APIRequestContext, FrameLocator, Page } from "@playwright/test";
import { FUNDERHUB_ORG_ID, FUNDERHUB_SEED, PORTAL_ORG_ID, PORTAL_SEED } from "@cg-link/seed";
import { ADMIN_EMAIL, FUNDERHUB_ORIGIN, LINK_ORIGIN, PORTAL_ORIGIN } from "../env.js";
import { connectInFrame, expect, openWidget, test } from "../fixtures.js";

/** The suite number typed on a portal's own page, before Link is opened. */
const NEW_SUITE = "Suite 450";

/** Each system's profile page for the demo org. */
const PROFILE = {
  portal: `${PORTAL_ORIGIN}/orgs/${PORTAL_ORG_ID}`,
  funderhub: `${FUNDERHUB_ORIGIN}/orgs/${FUNDERHUB_ORG_ID}`,
};

/** The widget, addressed inside the overlay the loader mounted. */
function widgetIn(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="cg-link-frame"]');
}

/**
 * Open the widget over the profile page already loaded, and wait for it.
 *
 * `data-ready` is published on mount inside the frame, so waiting for it
 * covers both the frame navigating and the widget hydrating — a click before
 * that lands on server-rendered markup with no handler attached.
 */
async function openLinkOver(page: Page): Promise<FrameLocator> {
  // The host page is server-rendered too, so Open Link exists before it does
  // anything. Waiting on the page's own readiness first is the difference
  // between opening the widget and clicking inert markup.
  await expect(page.getByTestId("profile")).toHaveAttribute("data-ready", "true");
  await page.getByTestId("open-link").click();

  const widget = widgetIn(page);

  await expect(widget.getByTestId("widget")).toHaveAttribute("data-ready", "true");

  return widget;
}

/**
 * `origin` spelled as a loopback literal that actually answers.
 *
 * `localhost` resolves to `::1` on some machines and `127.0.0.1` on others, and
 * the dev server binds only what it resolved to — so the other spelling is a
 * connection error rather than a second origin. Picking the reachable one keeps
 * the assertion about `frame-ancestors`: an unreachable alias would leave the
 * frame empty too, and the test would pass without the policy doing anything.
 */
async function loopbackAlias(request: APIRequestContext, origin: string): Promise<string> {
  for (const literal of ["127.0.0.1", "[::1]"]) {
    const candidate = origin.replace("localhost", literal);

    try {
      await request.get(`${candidate}/`);

      return candidate;
    } catch {
      // Not bound to this spelling. Try the other one.
    }
  }

  throw new Error(`No loopback spelling of ${origin} answered — cannot test frame-ancestors.`);
}

test("Link is framed by a host on the allow-list and refused by one outside it", async ({
  page,
  request,
}) => {
  // The policy itself, exactly. A spec that only drove the allowed case would
  // pass just as well against a Link that let anyone frame it, and the two
  // origins named here are the only two that may.
  const response = await request.get(`${LINK_ORIGIN}/`);

  expect(response.headers()["content-security-policy"]).toBe(
    `frame-ancestors 'self' ${PORTAL_ORIGIN} ${FUNDERHUB_ORIGIN}`,
  );

  /**
   * Load one host page and put Link in an iframe on it.
   *
   * The frame is appended by script on a page the portal really served, rather
   * than by a `page.route` stand-in: a fulfilled response does not carry the
   * origin Chromium checks `frame-ancestors` against, so a stand-in host is
   * refused even when its URL is on the list.
   */
  const frameLinkFrom = async (hostOrigin: string): Promise<void> => {
    await page.goto(`${hostOrigin}/`);
    await page.evaluate((src) => {
      const frame = document.createElement("iframe");

      frame.src = src;
      frame.setAttribute("data-testid", "probe");
      document.body.appendChild(frame);
    }, `${LINK_ORIGIN}/`);
  };

  // GrantPortal's real origin, which the allow-list names.
  await frameLinkFrom(PORTAL_ORIGIN);
  await expect(page.frameLocator('[data-testid="probe"]').getByTestId("widget")).toBeVisible();

  // The same server, reached by a host name the allow-list does not name.
  // A loopback literal and `localhost` are one machine and two origins, which
  // is the whole point: the policy is about origins, not about whose server it
  // is. Chromium refuses the frame outright, so there is no document to query.
  const outside = await loopbackAlias(request, PORTAL_ORIGIN);

  await frameLinkFrom(outside);
  await expect(page.frameLocator('[data-testid="probe"]').getByTestId("widget")).toHaveCount(0);
});

test("standalone, the widget has no host to talk to and says so", async ({ page }) => {
  await openWidget(page);

  await expect(page.getByTestId("widget")).toHaveAttribute("data-embedded", "false");
  await expect(page.getByTestId("close")).toHaveCount(0);
  await expect(page.getByTestId("host-system")).toHaveCount(0);
});

test("a sync inside the frame updates the host page without reloading it", async ({ page }) => {
  // Opened from FunderHub, so the value being pushed lands on the host's own
  // screen. That is the beat this spec is about: the page behind the overlay
  // catches up on its own.
  await page.goto(PROFILE.funderhub);

  const widget = await openLinkOver(page);

  await expect(widget.getByTestId("host-system")).toContainText("FunderHub");

  await connectInFrame(page, widget, "portal", ADMIN_EMAIL, PORTAL_ORG_ID);
  await connectInFrame(page, widget, "funderhub", ADMIN_EMAIL, FUNDERHUB_ORG_ID);

  // A mark on the host window that only a document load would clear. Without
  // it "the values changed" would pass for a full reload too, which is the
  // thing the bridge exists to avoid.
  await page.evaluate(() => {
    (window as unknown as { embedProbe?: string }).embedProbe = "kept";
  });

  await widget.getByTestId("pick-addresses.primary-portal").click();
  await widget.getByTestId("sync").click();
  await expect(widget.getByTestId("sync-result-funderhub")).toHaveAttribute("data-ok", "true");

  const street2 = PORTAL_SEED.addresses?.primary?.street2;

  // The host re-read on the `synced` message, so its own form now holds what
  // the widget just wrote — with the frame still open over it.
  await expect(page.getByTestId("input-street2")).toHaveValue(String(street2));
  await expect(page.locator('[data-testid="cg-link-frame"]')).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { embedProbe?: string }).embedProbe)).toBe(
    "kept",
  );
});

test("an edit on GrantPortal, pushed from the frame, lands on FunderHub's own page", async ({
  page,
}) => {
  // 1. The presenter changes the suite number where they keep their profile.
  await page.goto(PROFILE.portal);
  await page.getByTestId("input-street2").fill(NEW_SUITE);
  await page.getByTestId("save").click();
  await expect(page.getByTestId("save-message")).toContainText("Change applied");

  // 2. Link opens over that page, already looking up this organization and
  //    knowing whose page it is on.
  const widget = await openLinkOver(page);

  await expect(widget.getByTestId("host-system")).toContainText("GrantPortal");

  await connectInFrame(page, widget, "portal", ADMIN_EMAIL, PORTAL_ORG_ID);
  await connectInFrame(page, widget, "funderhub", ADMIN_EMAIL, FUNDERHUB_ORG_ID);

  // The org the loader passed in the frame URL, which is this page's own EIN
  // rather than anything the person typed — the widget is deep-linked at it,
  // which is why the organization step had nothing left to choose.
  await expect(widget.getByTestId("linked-org")).toContainText(
    String(PORTAL_SEED.identifiers?.["org:us:ein"]?.id),
  );

  // 3. The row disagrees, because step 1 is what made it disagree.
  await expect(widget.getByTestId("row-addresses.primary")).toHaveAttribute(
    "data-status",
    "differs",
  );
  await expect(widget.getByTestId("cell-addresses.primary-portal")).toContainText(NEW_SUITE);

  // 4. Push GrantPortal's address to FunderHub. The host's own value going
  //    outward is a push, and the panel says so before anything is sent.
  await widget.getByTestId("pick-addresses.primary-portal").click();
  await expect(widget.getByTestId("direction")).toHaveAttribute("data-direction", "push");
  await expect(widget.getByTestId("direction")).toContainText(
    "Push Primary address from GrantPortal to FunderHub",
  );

  await widget.getByTestId("sync").click();
  await expect(widget.getByTestId("sync-result-funderhub")).toHaveAttribute("data-ok", "true");
  await expect(widget.getByTestId("row-addresses.primary")).toHaveAttribute("data-status", "agree");

  // 5. Close from inside the frame: the widget asks, the host page removes it.
  await widget.getByTestId("close").click();
  await expect(page.locator('[data-testid="cg-link-frame"]')).toHaveCount(0);

  // 6. And the value is on FunderHub's own screen, typed by nobody there.
  await page.goto(PROFILE.funderhub);
  await expect(page.getByTestId("input-street2")).toHaveValue(NEW_SUITE);
});

test("pulling FunderHub's value into GrantPortal lands on GrantPortal's own page", async ({
  page,
}) => {
  // The mirror of the spec above, and the second beat of the demo: standing on
  // GrantPortal, the presenter takes the value FunderHub holds. Same request
  // over the protocol — a PATCH to one system — and the opposite direction on
  // screen, which is the whole point of naming it.
  await page.goto(PROFILE.portal);

  const widget = await openLinkOver(page);

  await connectInFrame(page, widget, "portal", ADMIN_EMAIL, PORTAL_ORG_ID);
  await connectInFrame(page, widget, "funderhub", ADMIN_EMAIL, FUNDERHUB_ORG_ID);

  await widget.getByTestId("pick-addresses.primary-funderhub").click();

  await expect(widget.getByTestId("direction")).toHaveAttribute("data-direction", "pull");
  await expect(widget.getByTestId("direction")).toContainText(
    "Pull Primary address from FunderHub into GrantPortal",
  );

  // A pull goes into the page you are on and nowhere else, so the host is the
  // only target offered — and it is offered, rather than the pick leaving a
  // disabled button with nothing to explain it.
  await expect(widget.getByTestId("target-portal")).toBeChecked();
  await expect(widget.getByTestId("target-funderhub")).toHaveCount(0);

  await widget.getByTestId("sync").click();

  const result = widget.getByTestId("sync-result-portal");

  await expect(result).toHaveAttribute("data-ok", "true");
  await expect(result).toContainText("pulled into");
  await expect(widget.getByTestId("row-addresses.primary")).toHaveAttribute("data-status", "agree");

  // And the host page behind the overlay has caught up on its own: the suite
  // number GrantPortal now holds is the one FunderHub had.
  const funderhubStreet2 = FUNDERHUB_SEED.addresses?.primary?.street2;

  await expect(page.getByTestId("input-street2")).toHaveValue(String(funderhubStreet2));
});
