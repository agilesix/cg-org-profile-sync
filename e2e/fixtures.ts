/**
 * The suite's one fixture: freshly seeded systems and a typed Link client.
 *
 * Both systems are in-memory and shared by every spec, so isolation has to come
 * from putting them back rather than from running apart. `api` is an automatic
 * fixture for exactly that reason — a spec that forgets to ask for it would
 * otherwise run against whatever the spec before it wrote.
 */

import {
  test as base,
  expect,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";
import type {
  CompareResult,
  FieldComparison,
  FieldChange,
  JsonValue,
  SyncResult,
} from "@cg-link/org-sync/types";
import { AGILE_SIX_EIN } from "@cg-link/seed";
import { SOURCE_TOKENS_HEADER, sourceTokensHeader } from "@cg-link/org-sync/client";
import { ADMIN_EMAIL, EIN_REGISTRY, LINK_ORIGIN, SYSTEM_ORIGINS } from "./env.js";

/** The body `POST /api/sync` takes, minus the registry and id the helper fills in. */
export interface SyncRequest {
  /**
   * The fields to set, sent as one patch per target.
   *
   * Each `path` is one of `DEMO_FIELDS`, and a `value` of `null` is legal —
   * it is how RFC 7396 clears a field.
   */
  changes: FieldChange[];

  /** `SourceConfig.id`s to write to. */
  targets: string[];
}

/**
 * Link's two routes, typed.
 *
 * `compare` and `sync` assert the happy path and hand back the parsed body,
 * because most specs care about what the systems said rather than about the
 * status. The `raw` pair skips that for the specs that are about the status.
 *
 * Paths are relative, so they resolve against `use.baseURL` — Link is the
 * thing under test and has one origin. The reset helper below spells its
 * origins out in full, because those are the systems *behind* the thing under
 * test and there is more than one of them.
 */
export class LinkApi {
  constructor(
    private readonly request: APIRequestContext,
    private readonly tokens: Readonly<Record<string, string>>,
  ) {}

  /**
   * The per-source tokens on every call.
   *
   * Link holds no credentials of its own, so a request without this header
   * reports every system as not connected — which is a legitimate answer, and
   * would make most of these specs pass while proving nothing. Putting it on
   * the client rather than in each spec is what stops one being forgotten.
   */
  private get headers(): Record<string, string> {
    return { [SOURCE_TOKENS_HEADER]: sourceTokensHeader(this.tokens) };
  }

  /** `GET /api/compare` for one org, asserting it answered. */
  async compare(
    id: string = AGILE_SIX_EIN,
    registry: string = EIN_REGISTRY,
  ): Promise<CompareResult> {
    const response = await this.rawCompare({ registry, id });

    expect(response.status(), await failureDetail(response, "GET /api/compare")).toBe(200);

    return (await response.json()) as CompareResult;
  }

  /** `GET /api/compare` with whatever query the spec wants, status included. */
  rawCompare(query: Record<string, string>): Promise<APIResponse> {
    return this.request.get("/api/compare", { params: query, headers: this.headers });
  }

  /** `POST /api/sync` for one or more fields, asserting it answered. */
  async sync(change: SyncRequest): Promise<SyncResult> {
    const response = await this.rawSync({
      registry: EIN_REGISTRY,
      id: AGILE_SIX_EIN,
      ...change,
    });

    expect(response.status(), await failureDetail(response, "POST /api/sync")).toBe(200);

    return (await response.json()) as SyncResult;
  }

  /**
   * `POST /api/sync` with an arbitrary body, status included.
   *
   * `data` is deliberately `unknown` and `string` is passed through as a raw
   * body, so a spec can send something that is not JSON at all.
   */
  rawSync(body: unknown): Promise<APIResponse> {
    if (typeof body === "string") {
      return this.request.post("/api/sync", {
        headers: { "content-type": "application/json", ...this.headers },
        data: body,
      });
    }

    // Playwright serializes anything non-string as JSON. The cast is only to
    // get `unknown` past the overload; the value is whatever the spec sent.
    return this.request.post("/api/sync", { data: body as object, headers: this.headers });
  }
}

/** Pull one field's row out of a comparison, failing clearly if it is absent. */
export function rowFor(result: CompareResult, path: string): FieldComparison {
  const row = result.fields.find((field) => field.path === path);

  expect(row, `no ${path} row in the comparison — is it still in DEMO_FIELDS?`).toBeDefined();

  // `expect(...).toBeDefined()` does not narrow, so assert for the type checker.
  return row as FieldComparison;
}

/**
 * The value one source holds for a field, asserting that it holds one at all.
 *
 * Worth a helper because the obvious alternative is a quiet way to pass. A
 * spec that reaches for `row.values.portal ?? null` and hands the result to
 * `sync` is not testing what it looks like: `null` is a legal value — it is
 * how RFC 7396 clears a field — so if the comparison were broken and returned
 * nothing for portal, the spec would go on to push a *deletion*, and every
 * assertion after it would still hold. Verified: the website sync spec passed
 * unchanged with a hardcoded `null` in place of the value it read.
 *
 * Failing the read here is what makes "this value travelled from one system to
 * another" a claim the spec actually checks.
 */
export function valueHeldBy(row: FieldComparison, sourceId: string): JsonValue {
  const value = row.values[sourceId];

  expect(value, `${sourceId} holds no value for ${row.path}`).toBeDefined();

  return value as JsonValue;
}

/** The one result for a target, failing clearly if the fan-out skipped it. */
export function resultFor(result: SyncResult, targetId: string) {
  const target = result.results.find((entry) => entry.id === targetId);

  expect(target, `no result for target ${targetId}`).toBeDefined();

  return target as SyncResult["results"][number];
}

export const test = base.extend<{ api: LinkApi }>({
  api: [
    async ({ request }, use) => {
      await resetSystems(request);

      // Real tokens through the real flow, rather than a credential the suite
      // was handed. Anything the specs prove about access is then something
      // the systems actually decided, not something the fixture asserted.
      //
      // Done for the browser specs too, which never read `api` and sign in
      // themselves. That is deliberate rather than waste: it is what makes a
      // portal running the real Google provider fail immediately, with the
      // sentence below naming the app, instead of as a browser click timing
      // out on a sign-in page the suite cannot fill in.
      await use(
        new LinkApi(request, {
          portal: await tokenFor(request, "portal", ADMIN_EMAIL),
          funderhub: await tokenFor(request, "funderhub", ADMIN_EMAIL),
          temelio: await tokenFor(request, "temelio", ADMIN_EMAIL),
        }),
      );
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Put every system back to its seed.
 *
 * Retried once on a *transport* failure. Playwright's `webServer` only waited
 * for each app's root page, so the first POST here is often what makes Vite
 * compile `/__test/reset` — that alone just makes the request slow rather than
 * throwing, but Vite drops in-flight connections when it re-optimizes deps,
 * which is exactly when it happens. A dropped socket on the very first request
 * of a run is not worth a red suite.
 *
 * A 404 is deliberately not retried: that is a configuration answer, not a
 * timing one, and retrying it would only delay the message below.
 */
async function resetSystems(request: APIRequestContext): Promise<void> {
  for (const [id, origin] of Object.entries(SYSTEM_ORIGINS)) {
    const response = await postReset(request, origin, 2);

    if (response.status() === 404) {
      throw new Error(
        `${id} answered 404 to POST /__test/reset. That route only exists when ` +
          `ENABLE_TEST_ROUTES=true — copy .env.example to .env in that app and ` +
          `restart its dev server.`,
      );
    }

    if (!response.ok()) {
      throw new Error(await failureDetail(response, `POST ${origin}/__test/reset`));
    }
  }
}

/** POST the reset route, retrying a transport failure the given number of times. */
async function postReset(
  request: APIRequestContext,
  origin: string,
  attempts: number,
): Promise<APIResponse> {
  try {
    return await request.post(`${origin}/__test/reset`);
  } catch (cause) {
    if (attempts <= 1) throw cause;

    return postReset(request, origin, attempts - 1);
  }
}

/** A one-line "what came back" for an assertion message. */
async function failureDetail(response: APIResponse, what: string): Promise<string> {
  return `${what} answered ${response.status()}: ${(await response.text()).slice(0, 400)}`;
}

/**
 * Sign in to one system and come back with the access token it issued.
 *
 * Drives the same four hops a browser does — Link's `/api/connect/start`, the
 * portal's `/oauth/authorize`, the fake sign-in form's callback, and Link's
 * own `/connect/callback` — and takes the JSON exit at the end, which exists
 * for exactly this. The PKCE verifier never appears here: it lives in an
 * `HttpOnly` cookie that Playwright's request context carries for us, the same
 * way a browser would.
 */
export async function tokenFor(
  request: APIRequestContext,
  sourceId: string,
  email: string,
): Promise<string> {
  const result = await connectViaApi(request, sourceId, email);

  if (!result.token) {
    // Said specifically. "Access denied" is a real answer about this person;
    // `problem` is the connect flow itself having gone wrong, and reporting
    // one as the other would send whoever reads this looking at grants when
    // the cookie had expired.
    const because = result.denied
      ? `it refused ${email} access`
      : (result.problem ?? "it returned no token and no reason");

    throw new Error(`${sourceId} issued no token: ${because}.`);
  }

  return result.token;
}

/**
 * The raw outcome of a connect attempt: a token, a refusal, or a broken flow.
 *
 * All three come back rather than only the first, because they mean different
 * things and the caller has to be able to say which happened.
 */
export interface ConnectOutcome {
  token?: string;
  denied?: boolean;
  problem?: string;
}

export async function connectViaApi(
  request: APIRequestContext,
  sourceId: string,
  email: string,
): Promise<ConnectOutcome> {
  const start = await getWithRetry(request, `${LINK_ORIGIN}/api/connect/start?source=${sourceId}`);

  const authorize = locationOf(start, `starting a connect to ${sourceId}`);
  const authorized = await getWithRetry(request, authorize);
  const provider = new URL(locationOf(authorized, `${sourceId}'s /oauth/authorize`));

  if (!provider.pathname.endsWith("/oauth/fake-login")) {
    throw new Error(
      `${sourceId} sent the sign-in to ${provider.host} rather than its own fake login page. ` +
        `This suite cannot drive a real identity provider — set IDENTITY_PROVIDER=fake in that ` +
        `app's .env and restart its dev server.`,
    );
  }

  // What the form's submit button does: a GET back to the portal's callback
  // carrying the signed state and whatever address was typed.
  const callback = new URL(`${provider.origin}/oauth/callback`);
  callback.searchParams.set("state", provider.searchParams.get("state") ?? "");
  callback.searchParams.set("email", email);

  const decided = await getWithRetry(request, callback.href);
  const backToLink = locationOf(decided, `${sourceId}'s /oauth/callback`);

  const finished = await request.get(backToLink, { headers: { accept: "application/json" } });

  return (await finished.json()) as ConnectOutcome;
}

/**
 * A redirect-stopping GET, retried once on a transport failure.
 *
 * Same reasoning as `postReset`, one route further in: `/oauth/*` is compiled
 * on first hit, and it is the first thing to pull in the signing and JWT code
 * that `/__test/reset` never touches — so the reset fixture has not already
 * absorbed that compile. Vite drops in-flight connections while it
 * re-optimizes, and a dropped socket on the first connect of a run is not
 * worth a red suite. A response of any status is returned as-is; only a throw
 * is retried.
 */
async function getWithRetry(
  request: APIRequestContext,
  url: string,
  attempts = 2,
): Promise<APIResponse> {
  try {
    return await request.get(url, { maxRedirects: 0 });
  } catch (cause) {
    if (attempts <= 1) throw cause;

    return getWithRetry(request, url, attempts - 1);
  }
}

/** One redirect's target, failing with what came back instead when there is none. */
function locationOf(response: APIResponse, what: string): string {
  const location = response.headers()["location"];

  if (!location) {
    throw new Error(`${what} did not redirect: ${response.status()}`);
  }

  return location;
}

/**
 * Connect one system in the browser, the way a person does.
 *
 * Waiting on `connected-{id}` rather than on the popup closing is what makes
 * it safe to assert straight afterwards: the widget re-reads every system once
 * a token lands, and that chip appears with the state that triggered the read.
 */
export async function connect(
  page: Page,
  sourceId: string,
  email: string,
  orgId: string,
): Promise<void> {
  await signIn(page, sourceId, email);
  await chooseOrg(page, orgId);
  await expect(page.getByTestId(`connected-${sourceId}`)).toBeVisible();
}

/**
 * Connect expecting to be turned away.
 *
 * A separate helper rather than a flag, because these are different claims:
 * one says a person got in, the other says a system correctly refused them.
 */
export async function connectExpectingDenial(
  page: Page,
  sourceId: string,
  email: string,
): Promise<void> {
  await signIn(page, sourceId, email);

  // The refusal is a step of the modal, not a badge on the page behind it:
  // the person is mid-flow and this is the answer to what they just did.
  await expect(page.getByTestId(`denied-${sourceId}`)).toBeVisible();
  await page.getByTestId("close-denied").click();
}

/**
 * Open the widget and wait for the browser to have taken it over.
 *
 * The page is server-rendered, so every button exists — and is clickable —
 * before any handler is attached. `data-ready` is set on mount, so waiting for
 * it is the difference between a click that selects a value and a click that
 * quietly does nothing.
 */
export async function openWidget(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("widget")).toHaveAttribute("data-ready", "true");
}

/**
 * Walk the picker: open it, choose a system, and sign in through its popup.
 *
 * The sign-in genuinely happens in a separate window — the widget opens one so
 * the modal can stay up and so Google, which will not render inside another
 * origin's page, has somewhere to go. `waitForEvent("popup")` has to be armed
 * BEFORE the click that opens it, or the event fires while nobody is
 * listening and the wait times out on a window that already exists.
 */
export async function signInVia(page: Page, sourceId: string, email: string): Promise<void> {
  await signIn(page, sourceId, email);
}

async function signIn(page: Page, sourceId: string, email: string): Promise<void> {
  if (!(await page.getByTestId("link-modal").isVisible())) {
    await page.getByTestId("link-system").click();
  }

  await page.getByTestId(`pick-system-${sourceId}`).click();

  const popupPromise = page.waitForEvent("popup");
  await page.getByTestId("continue-with-google").click();
  const popup = await popupPromise;

  await popup.getByLabel("Email").fill(email);
  await popup.getByRole("button", { name: "Submit" }).click();
}

/**
 * Choose an organization and finish linking.
 *
 * Split from `signIn` because the two halves fail for different reasons: one
 * is about whether a system let this person in, the other about which record
 * they then picked. `orgId` names the system's own id for it, which is what
 * the row's `data-testid` carries.
 */
async function chooseOrg(page: Page, orgId: string): Promise<void> {
  const row = page.getByTestId(`org-${orgId}`);

  await expect(row).toBeVisible();

  // Clicking is a toggle, and on the second system the matching organization
  // is already pre-selected — the lock leaves exactly one choice, so the
  // widget makes it. Clicking anyway would unpick it and leave Continue
  // disabled, which is a helper bug that reads exactly like a product one.
  if ((await row.getAttribute("aria-pressed")) !== "true") {
    await row.click();
  }

  await page.getByTestId("confirm-org").click();
}
