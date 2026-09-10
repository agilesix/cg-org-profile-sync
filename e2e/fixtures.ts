/**
 * The suite's one fixture: freshly seeded systems and a typed Link client.
 *
 * Both systems are in-memory and shared by every spec, so isolation has to come
 * from putting them back rather than from running apart. `api` is an automatic
 * fixture for exactly that reason — a spec that forgets to ask for it would
 * otherwise run against whatever the spec before it wrote.
 */

import { test as base, expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import type {
  CompareResult,
  FieldComparison,
  JsonValue,
  SyncResult,
} from "@cg-link/org-sync/types";
import { AGILE_SIX_EIN } from "@cg-link/seed";
import { EIN_REGISTRY, SYSTEM_ORIGINS } from "./env.js";

/** The body `POST /api/sync` takes, minus the registry and id the helper fills in. */
export interface SyncRequest {
  /** Dot path of the single field being set. One of `DEMO_FIELDS`. */
  path: string;

  /** The value to store. `null` is legal — it is how RFC 7396 clears a field. */
  value: JsonValue;

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
  constructor(private readonly request: APIRequestContext) {}

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
    return this.request.get("/api/compare", { params: query });
  }

  /** `POST /api/sync` for one field, asserting it answered. */
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
        headers: { "content-type": "application/json" },
        data: body,
      });
    }

    // Playwright serializes anything non-string as JSON. The cast is only to
    // get `unknown` past the overload; the value is whatever the spec sent.
    return this.request.post("/api/sync", { data: body as object });
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
      await use(new LinkApi(request));
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
