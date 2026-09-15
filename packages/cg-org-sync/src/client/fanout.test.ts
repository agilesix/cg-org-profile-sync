import {
  AGILE_SIX_EIN,
  FUNDERHUB_ORG_ID,
  FUNDERHUB_SEED,
  PORTAL_ORG_ID,
  PORTAL_SEED,
} from "@cg-link/seed";
import { describe, expect, it } from "vitest";
import type { Organization } from "../schemas/index.js";
import type { JsonObject, SourceConfig, TokenProvider } from "../types.js";
import { DEMO_FIELDS, buildMergePatch } from "../utils/index.js";
import { NotConnectedError, StaticTokenProvider } from "./org-client.js";
import { compareAcrossSources, listOrgsAt, syncToTargets } from "./fanout.js";

const PORTAL_SOURCE: SourceConfig = {
  id: "portal",
  label: "GrantPortal",
  baseUrl: "https://portal.example.com",
  enabled: true,
};

const FUNDERHUB_SOURCE: SourceConfig = {
  id: "funderhub",
  label: "FunderHub",
  baseUrl: "https://funderhub.example.com",
  enabled: true,
};

/** The paginated envelope `GET /common-grants/orgs` responds with. */
function listEnvelope(items: readonly Organization[]): Response {
  return new Response(
    JSON.stringify({
      status: 200,
      message: "Success",
      items,
      paginationInfo: { page: 1, pageSize: 100, totalItems: items.length, totalPages: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** The single-resource envelope `PATCH /common-grants/orgs/{orgId}` responds with. */
function revisionEnvelope(message: string, data: JsonObject): Response {
  return new Response(JSON.stringify({ status: 200, message, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** The revision record `PATCH /common-grants/orgs/{orgId}` reports the change as. */
function revision(source: SourceConfig, patch: JsonObject, snapshot: Organization): JsonObject {
  const now = new Date().toISOString();

  return {
    id: "018f2e77-1a2b-7c3d-8e4f-000000000099",
    status: { value: "accepted", description: "The change was applied." },
    source: source.id,
    patch,
    snapshot: snapshot as unknown as JsonObject,
    createdAt: now,
    lastModifiedAt: now,
  };
}

/**
 * A `fetch` stub that answers by the request's origin, so two sources share one stub.
 *
 * An origin may map to an `Error` instead of a `Response`, so a test can stand
 * in for an unreachable host (a DNS failure or refused connection) alongside
 * origins that answer normally. An origin may also map to a function of the
 * request's method, so a source that gets both a `GET` (the identifier lookup)
 * and a `PATCH` (the write) in the same test can answer each with its own,
 * freshly-built `Response` — a `Response` body can only be read once.
 */
function stubFetchByOrigin(
  responses: Readonly<Record<string, Response | Error | ((method: string) => Response | Error)>>,
): typeof globalThis.fetch {
  return async (input, init) => {
    const url =
      input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    const responder = responses[url.origin];

    if (!responder) {
      throw new Error(`no stubbed response for origin ${url.origin}`);
    }

    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const response = typeof responder === "function" ? responder(method) : responder;

    if (response instanceof Error) {
      throw response;
    }

    return response;
  };
}

/** Answers a `GET` and a `PATCH` to the same origin with their own responses. */
function respondByMethod(handlers: {
  get: () => Response | Error;
  patch: () => Response | Error;
}): (method: string) => Response | Error {
  return (method) => (method === "PATCH" ? handlers.patch() : handlers.get());
}

/** A `fetch` stub that also records the `Request`s it saw, for assertions on the wire form. */
function captureFetch(inner: typeof globalThis.fetch): {
  fetch: typeof globalThis.fetch;
  calls: Request[];
} {
  const calls: Request[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push(new Request(input, init));
    return inner(input, init);
  };

  return { fetch, calls };
}

/**
 * A `TokenProvider` that has connected some sources but not others, standing in
 * for a browser that has been through one system's OAuth flow but not the
 * other's, without pulling `tokensFromHeader`'s own parsing into this file.
 */
class PartialTokenProvider implements TokenProvider {
  readonly #tokens: Readonly<Record<string, string>>;
  readonly #notConnected: ReadonlySet<string>;

  constructor(tokens: Readonly<Record<string, string>>, notConnected: readonly string[]) {
    this.#tokens = tokens;
    this.#notConnected = new Set(notConnected);
  }

  async tokenFor(sourceId: string): Promise<string> {
    if (this.#notConnected.has(sourceId)) {
      throw new NotConnectedError(sourceId);
    }

    const token = this.#tokens[sourceId];

    if (token === undefined) {
      throw new Error(`no stubbed token for ${sourceId}`);
    }

    return token;
  }
}

/** The error envelope a rejected request's body carries. */
function errorEnvelope(status: number, message: string): Response {
  return new Response(JSON.stringify({ status, message, errors: [] }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A minimal, valid organization with no `org:us:ein` identifier. */
const NO_EIN_ORG: Organization = {
  id: "018f2e77-1a2b-7c3d-8e4f-000000000098",
  name: "Org With No EIN",
};

/** A second organization, distinct from `PORTAL_SEED`, to prove ordering. */
const SECOND_ORG: Organization = {
  id: "018f2e77-1a2b-7c3d-8e4f-000000000097",
  name: "Second Org",
  identifiers: {
    "org:us:ein": {
      registry: { code: "org:us:ein", url: "https://commongrants.org/registries/org-us-ein" },
      id: "987654321",
    },
  },
};

describe("listOrgsAt", () => {
  it("returns every org a source holds, as summaries in the source's own order", async () => {
    const fetch = stubFetchByOrigin({
      "https://portal.example.com": listEnvelope([SECOND_ORG, PORTAL_SEED]),
    });
    const tokens = new StaticTokenProvider({ portal: "portal-token" });

    const result = await listOrgsAt("portal", {
      sources: [PORTAL_SOURCE],
      tokens,
      fetch,
    });

    expect(result.id).toBe("portal");
    expect(result.connection).toBe("connected");
    expect(result.error).toBeUndefined();
    expect(result.orgs).toEqual([
      { id: SECOND_ORG.id, name: SECOND_ORG.name, ein: "987654321" },
      { id: PORTAL_ORG_ID, name: PORTAL_SEED.name, ein: AGILE_SIX_EIN },
    ]);
  });

  it("keeps an org with no org:us:ein identifier in the list, with ein: null", async () => {
    const fetch = stubFetchByOrigin({
      "https://portal.example.com": listEnvelope([PORTAL_SEED, NO_EIN_ORG]),
    });
    const tokens = new StaticTokenProvider({ portal: "portal-token" });

    const result = await listOrgsAt("portal", {
      sources: [PORTAL_SOURCE],
      tokens,
      fetch,
    });

    expect(result.orgs).toHaveLength(2);
    expect(result.orgs).toContainEqual({ id: NO_EIN_ORG.id, name: NO_EIN_ORG.name, ein: null });
  });

  it("reports a source with no connected token as not-connected without sending it a request", async () => {
    const { fetch, calls } = captureFetch(stubFetchByOrigin({}));
    const tokens = new PartialTokenProvider({}, ["portal"]);

    const result = await listOrgsAt("portal", {
      sources: [PORTAL_SOURCE],
      tokens,
      fetch,
    });

    expect(result.connection).toBe("not-connected");
    expect(result.orgs).toEqual([]);
    expect(typeof result.error).toBe("string");
    expect(result.error).toContain("GrantPortal");
    expect(calls).toHaveLength(0);
  });

  it("marks a source that answers 401 as expired", async () => {
    const fetch = stubFetchByOrigin({
      "https://portal.example.com": errorEnvelope(401, "GrantPortal rejected the request."),
    });
    const tokens = new StaticTokenProvider({ portal: "portal-token" });

    const result = await listOrgsAt("portal", {
      sources: [PORTAL_SOURCE],
      tokens,
      fetch,
    });

    expect(result.connection).toBe("expired");
    expect(result.orgs).toEqual([]);
    expect(typeof result.error).toBe("string");
  });

  it("marks a source that fails with a 500 as connected, since being refused is not a connection problem", async () => {
    const fetch = stubFetchByOrigin({
      "https://portal.example.com": errorEnvelope(500, "GrantPortal had a problem."),
    });
    const tokens = new StaticTokenProvider({ portal: "portal-token" });

    const result = await listOrgsAt("portal", {
      sources: [PORTAL_SOURCE],
      tokens,
      fetch,
    });

    expect(result.connection).toBe("connected");
    expect(result.orgs).toEqual([]);
    expect(typeof result.error).toBe("string");
    expect(result.error).toContain("GrantPortal");
  });

  it("reports no such enabled source without sending anything, for an unknown or disabled id", async () => {
    const { fetch, calls } = captureFetch(stubFetchByOrigin({}));
    const tokens = new StaticTokenProvider({ portal: "portal-token" });
    const disabled: SourceConfig = { ...PORTAL_SOURCE, enabled: false };

    const unknown = await listOrgsAt("nonexistent", { sources: [PORTAL_SOURCE], tokens, fetch });
    const off = await listOrgsAt("portal", { sources: [disabled], tokens, fetch });

    expect(unknown.orgs).toEqual([]);
    expect(unknown.error).toBe("No enabled source is configured with the id nonexistent.");

    expect(off.orgs).toEqual([]);
    expect(off.error).toBe("No enabled source is configured with the id portal.");

    // `connected` rather than `not-connected`, and pinned because Link's route
    // turns only `not-connected` into a 401. A misconfigured source id is not
    // something signing in again could fix, so offering Connect for it would
    // send someone round a loop that ends back here.
    expect(unknown.connection).toBe("connected");
    expect(off.connection).toBe("connected");

    expect(calls).toHaveLength(0);
  });

  it("refuses a source declared unreadable, without sending it anything", async () => {
    const unreadable: SourceConfig = {
      ...PORTAL_SOURCE,
      capabilities: { read: false, write: true },
    };
    const { fetch, calls } = captureFetch(stubFetchByOrigin({}));
    const tokens = new StaticTokenProvider({ portal: "portal-token" });

    const result = await listOrgsAt("portal", { sources: [unreadable], tokens, fetch });

    expect(result.orgs).toEqual([]);
    expect(result.error).toContain("cannot be read");

    // As above: a source that declares itself unreadable is not one a second
    // sign-in would open up, so it must not come back as `not-connected`.
    expect(result.connection).toBe("connected");
    expect(calls).toHaveLength(0);
  });
});

describe("compareAcrossSources", () => {
  it("resolves each enabled source's org id and compares DEMO_FIELDS across them", async () => {
    const fetch = stubFetchByOrigin({
      "https://portal.example.com": listEnvelope([PORTAL_SEED]),
      "https://funderhub.example.com": listEnvelope([FUNDERHUB_SEED]),
    });
    const tokens = new StaticTokenProvider({
      portal: "portal-token",
      funderhub: "funderhub-token",
    });

    const result = await compareAcrossSources("org:us:ein", AGILE_SIX_EIN, {
      sources: [PORTAL_SOURCE, FUNDERHUB_SOURCE],
      tokens,
      fetch,
    });

    // Both demo sources declare no `capabilities`, so both rows carry the
    // permissive default — asserted as part of the whole row rather than
    // separately, since this is the one test that pins a resolution's shape.
    const both = { read: true, write: true };

    expect(result.sources).toEqual([
      {
        id: "portal",
        label: "GrantPortal",
        orgId: PORTAL_ORG_ID,
        connection: "connected",
        capabilities: both,
      },
      {
        id: "funderhub",
        label: "FunderHub",
        orgId: FUNDERHUB_ORG_ID,
        connection: "connected",
        capabilities: both,
      },
    ]);

    expect(result.fields).toHaveLength(DEMO_FIELDS.length);

    const address = result.fields.find((field) => field.path === "addresses.primary");
    expect(address?.status).toBe("differs");

    const name = result.fields.find((field) => field.path === "name");
    expect(name?.status).toBe("agree");
  });

  it("reports a source that returns 401 by id while the other source still contributes", async () => {
    const fetch = stubFetchByOrigin({
      "https://portal.example.com": errorEnvelope(401, "GrantPortal rejected the request."),
      "https://funderhub.example.com": listEnvelope([FUNDERHUB_SEED]),
    });
    const tokens = new StaticTokenProvider({
      portal: "portal-token",
      funderhub: "funderhub-token",
    });

    const result = await compareAcrossSources("org:us:ein", AGILE_SIX_EIN, {
      sources: [PORTAL_SOURCE, FUNDERHUB_SOURCE],
      tokens,
      fetch,
    });

    const portal = result.sources.find((source) => source.id === "portal");
    expect(portal?.orgId).toBeNull();
    expect(typeof portal?.error).toBe("string");
    expect(portal?.error).toContain("GrantPortal");

    const funderhub = result.sources.find((source) => source.id === "funderhub");
    expect(funderhub?.orgId).toBe(FUNDERHUB_ORG_ID);
    expect(funderhub?.error).toBeUndefined();

    const name = result.fields.find((field) => field.path === "name");
    expect(name?.values["funderhub"]).toBe(FUNDERHUB_SEED.name);
  });

  it("reports a source that is unreachable by id while the other source still contributes", async () => {
    const fetch = stubFetchByOrigin({
      "https://portal.example.com": new TypeError("fetch failed"),
      "https://funderhub.example.com": listEnvelope([FUNDERHUB_SEED]),
    });
    const tokens = new StaticTokenProvider({
      portal: "portal-token",
      funderhub: "funderhub-token",
    });

    const result = await compareAcrossSources("org:us:ein", AGILE_SIX_EIN, {
      sources: [PORTAL_SOURCE, FUNDERHUB_SOURCE],
      tokens,
      fetch,
    });

    const portal = result.sources.find((source) => source.id === "portal");
    expect(portal?.orgId).toBeNull();
    expect(typeof portal?.error).toBe("string");
    expect(portal?.error).toContain("GrantPortal");

    const funderhub = result.sources.find((source) => source.id === "funderhub");
    expect(funderhub?.orgId).toBe(FUNDERHUB_ORG_ID);
    expect(funderhub?.error).toBeUndefined();
  });

  it("does not report an error when a source simply holds no matching org", async () => {
    const fetch = stubFetchByOrigin({
      "https://portal.example.com": listEnvelope([]),
      "https://funderhub.example.com": listEnvelope([FUNDERHUB_SEED]),
    });
    const tokens = new StaticTokenProvider({
      portal: "portal-token",
      funderhub: "funderhub-token",
    });

    const result = await compareAcrossSources("org:us:ein", AGILE_SIX_EIN, {
      sources: [PORTAL_SOURCE, FUNDERHUB_SOURCE],
      tokens,
      fetch,
    });

    const portal = result.sources.find((source) => source.id === "portal");
    expect(portal?.orgId).toBeNull();
    expect(portal?.error).toBeUndefined();

    const funderhub = result.sources.find((source) => source.id === "funderhub");
    expect(funderhub?.orgId).toBe(FUNDERHUB_ORG_ID);
    expect(funderhub?.error).toBeUndefined();
  });

  it("marks a source that answers normally as connected", async () => {
    const fetch = stubFetchByOrigin({
      "https://portal.example.com": listEnvelope([PORTAL_SEED]),
      "https://funderhub.example.com": listEnvelope([FUNDERHUB_SEED]),
    });
    const tokens = new StaticTokenProvider({
      portal: "portal-token",
      funderhub: "funderhub-token",
    });

    const result = await compareAcrossSources("org:us:ein", AGILE_SIX_EIN, {
      sources: [PORTAL_SOURCE, FUNDERHUB_SOURCE],
      tokens,
      fetch,
    });

    expect(result.sources.map((source) => source.connection)).toEqual(["connected", "connected"]);
  });

  it("marks a source as connected even when it simply holds no matching org", async () => {
    const fetch = stubFetchByOrigin({
      "https://portal.example.com": listEnvelope([]),
      "https://funderhub.example.com": listEnvelope([FUNDERHUB_SEED]),
    });
    const tokens = new StaticTokenProvider({
      portal: "portal-token",
      funderhub: "funderhub-token",
    });

    const result = await compareAcrossSources("org:us:ein", AGILE_SIX_EIN, {
      sources: [PORTAL_SOURCE, FUNDERHUB_SOURCE],
      tokens,
      fetch,
    });

    const portal = result.sources.find((source) => source.id === "portal");
    expect(portal?.connection).toBe("connected");
    expect(portal?.orgId).toBeNull();
    expect(portal?.error).toBeUndefined();
  });

  it("marks a source that answers 401 as expired rather than not-connected, since it needs Reconnect, not Connect", async () => {
    const fetch = stubFetchByOrigin({
      "https://portal.example.com": errorEnvelope(401, "GrantPortal rejected the request."),
      "https://funderhub.example.com": listEnvelope([FUNDERHUB_SEED]),
    });
    const tokens = new StaticTokenProvider({
      portal: "portal-token",
      funderhub: "funderhub-token",
    });

    const result = await compareAcrossSources("org:us:ein", AGILE_SIX_EIN, {
      sources: [PORTAL_SOURCE, FUNDERHUB_SOURCE],
      tokens,
      fetch,
    });

    const portal = result.sources.find((source) => source.id === "portal");
    expect(portal?.connection).toBe("expired");
    expect(portal?.orgId).toBeNull();
    expect(typeof portal?.error).toBe("string");

    const funderhub = result.sources.find((source) => source.id === "funderhub");
    expect(funderhub?.connection).toBe("connected");
  });

  it("marks a source that fails with a 500 as connected, since being refused is different from never being let in", async () => {
    const fetch = stubFetchByOrigin({
      "https://portal.example.com": errorEnvelope(500, "GrantPortal had a problem."),
      "https://funderhub.example.com": listEnvelope([FUNDERHUB_SEED]),
    });
    const tokens = new StaticTokenProvider({
      portal: "portal-token",
      funderhub: "funderhub-token",
    });

    const result = await compareAcrossSources("org:us:ein", AGILE_SIX_EIN, {
      sources: [PORTAL_SOURCE, FUNDERHUB_SOURCE],
      tokens,
      fetch,
    });

    const portal = result.sources.find((source) => source.id === "portal");
    expect(portal?.connection).toBe("connected");
    expect(portal?.orgId).toBeNull();
    expect(typeof portal?.error).toBe("string");
  });

  it("reports a source with no connected token as not-connected without sending it a request, while the other source still answers", async () => {
    const { fetch, calls } = captureFetch(
      stubFetchByOrigin({
        "https://funderhub.example.com": listEnvelope([FUNDERHUB_SEED]),
      }),
    );
    const tokens = new PartialTokenProvider({ funderhub: "funderhub-token" }, ["portal"]);

    const result = await compareAcrossSources("org:us:ein", AGILE_SIX_EIN, {
      sources: [PORTAL_SOURCE, FUNDERHUB_SOURCE],
      tokens,
      fetch,
    });

    const portal = result.sources.find((source) => source.id === "portal");
    expect(portal?.connection).toBe("not-connected");
    expect(portal?.orgId).toBeNull();
    expect(typeof portal?.error).toBe("string");

    const funderhub = result.sources.find((source) => source.id === "funderhub");
    expect(funderhub?.connection).toBe("connected");
    expect(funderhub?.orgId).toBe(FUNDERHUB_ORG_ID);

    // The point of "not connected": no credential means no request was ever
    // sent, unlike a forwarded request that would 401 and look the same from
    // the outside.
    expect(calls.some((request) => request.url.startsWith("https://portal.example.com"))).toBe(
      false,
    );
  });
});

describe("syncToTargets", () => {
  it("builds one merge patch, PATCHes each target, and returns one result per target in order", async () => {
    const mergePatch = buildMergePatch("socials.website", "https://agile6.com");
    const { fetch, calls } = captureFetch(
      stubFetchByOrigin({
        "https://portal.example.com": respondByMethod({
          get: () => listEnvelope([PORTAL_SEED]),
          patch: () =>
            revisionEnvelope("Change applied", revision(PORTAL_SOURCE, mergePatch, PORTAL_SEED)),
        }),
        "https://funderhub.example.com": respondByMethod({
          get: () => listEnvelope([FUNDERHUB_SEED]),
          patch: () =>
            revisionEnvelope(
              "Change applied",
              revision(FUNDERHUB_SOURCE, mergePatch, FUNDERHUB_SEED),
            ),
        }),
      }),
    );
    const tokens = new StaticTokenProvider({
      portal: "portal-token",
      funderhub: "funderhub-token",
    });

    const result = await syncToTargets(
      {
        registry: "org:us:ein",
        id: AGILE_SIX_EIN,
        path: "socials.website",
        value: "https://agile6.com",
        targets: ["portal", "funderhub"],
      },
      { sources: [PORTAL_SOURCE, FUNDERHUB_SOURCE], tokens, fetch },
    );

    expect(result.results).toEqual([
      { id: "portal", ok: true, status: 200, message: "Change applied" },
      { id: "funderhub", ok: true, status: 200, message: "Change applied" },
    ]);

    const portalPatch = calls.find(
      (request) =>
        request.url.startsWith("https://portal.example.com") && request.method === "PATCH",
    );
    expect(portalPatch).toBeDefined();
    expect(portalPatch?.headers.get("content-type")).toBe("application/merge-patch+json");
    expect(await portalPatch?.json()).toEqual({ socials: { website: "https://agile6.com" } });
  });

  it("passes a target's decline message through verbatim", async () => {
    const message = "Change applied. This system does not store socials.";
    const fetch = stubFetchByOrigin({
      "https://funderhub.example.com": respondByMethod({
        get: () => listEnvelope([FUNDERHUB_SEED]),
        patch: () => revisionEnvelope(message, revision(FUNDERHUB_SOURCE, {}, FUNDERHUB_SEED)),
      }),
    });
    const tokens = new StaticTokenProvider({ funderhub: "funderhub-token" });

    const result = await syncToTargets(
      {
        registry: "org:us:ein",
        id: AGILE_SIX_EIN,
        path: "socials.website",
        value: "https://agile6.com",
        targets: ["funderhub"],
      },
      { sources: [FUNDERHUB_SOURCE], tokens, fetch },
    );

    expect(result.results).toEqual([{ id: "funderhub", ok: true, status: 200, message }]);
  });

  it("skips a target with no resolved org id rather than throwing, while the other target still succeeds", async () => {
    const mergePatch = buildMergePatch("socials.website", "https://agile6.com");
    const fetch = stubFetchByOrigin({
      "https://portal.example.com": respondByMethod({
        get: () => listEnvelope([]),
        patch: () => {
          throw new Error("portal should never receive a PATCH when it has no resolved org id");
        },
      }),
      "https://funderhub.example.com": respondByMethod({
        get: () => listEnvelope([FUNDERHUB_SEED]),
        patch: () =>
          revisionEnvelope(
            "Change applied",
            revision(FUNDERHUB_SOURCE, mergePatch, FUNDERHUB_SEED),
          ),
      }),
    });
    const tokens = new StaticTokenProvider({
      portal: "portal-token",
      funderhub: "funderhub-token",
    });

    const result = await syncToTargets(
      {
        registry: "org:us:ein",
        id: AGILE_SIX_EIN,
        path: "socials.website",
        value: "https://agile6.com",
        targets: ["portal", "funderhub"],
      },
      { sources: [PORTAL_SOURCE, FUNDERHUB_SOURCE], tokens, fetch },
    );

    const portal = result.results.find((entry) => entry.id === "portal");
    expect(portal?.ok).toBe(false);
    expect(portal?.status).toBeNull();
    expect(portal?.message.length).toBeGreaterThan(0);

    const funderhub = result.results.find((entry) => entry.id === "funderhub");
    expect(funderhub).toEqual({
      id: "funderhub",
      ok: true,
      status: 200,
      message: "Change applied",
    });
  });

  it("does not PATCH the same target twice for a duplicate entry in targets", async () => {
    const mergePatch = buildMergePatch("socials.website", "https://agile6.com");
    const { fetch, calls } = captureFetch(
      stubFetchByOrigin({
        "https://portal.example.com": respondByMethod({
          get: () => listEnvelope([PORTAL_SEED]),
          patch: () =>
            revisionEnvelope("Change applied", revision(PORTAL_SOURCE, mergePatch, PORTAL_SEED)),
        }),
      }),
    );
    const tokens = new StaticTokenProvider({ portal: "portal-token" });

    const result = await syncToTargets(
      {
        registry: "org:us:ein",
        id: AGILE_SIX_EIN,
        path: "socials.website",
        value: "https://agile6.com",
        targets: ["portal", "portal"],
      },
      { sources: [PORTAL_SOURCE], tokens, fetch },
    );

    const portalPatches = calls.filter((request) => request.method === "PATCH");
    expect(portalPatches).toHaveLength(1);
    expect(result.results).toEqual([
      { id: "portal", ok: true, status: 200, message: "Change applied" },
    ]);
  });

  it("sends a null value through to the wire, since null is how RFC 7396 spells clearing a field", async () => {
    const { fetch, calls } = captureFetch(
      stubFetchByOrigin({
        "https://portal.example.com": respondByMethod({
          get: () => listEnvelope([PORTAL_SEED]),
          patch: () =>
            revisionEnvelope(
              "Change applied",
              revision(PORTAL_SOURCE, { socials: { website: null } }, PORTAL_SEED),
            ),
        }),
      }),
    );
    const tokens = new StaticTokenProvider({ portal: "portal-token" });

    await syncToTargets(
      {
        registry: "org:us:ein",
        id: AGILE_SIX_EIN,
        path: "socials.website",
        value: null,
        targets: ["portal"],
      },
      { sources: [PORTAL_SOURCE], tokens, fetch },
    );

    const portalPatch = calls.find((request) => request.method === "PATCH");
    expect(await portalPatch?.json()).toEqual({ socials: { website: null } });
  });

  it("reports a target with no connected token as not connected, without sending it a request, while the other target still succeeds", async () => {
    const mergePatch = buildMergePatch("socials.website", "https://agile6.com");
    const { fetch, calls } = captureFetch(
      stubFetchByOrigin({
        "https://funderhub.example.com": respondByMethod({
          get: () => listEnvelope([FUNDERHUB_SEED]),
          patch: () =>
            revisionEnvelope(
              "Change applied",
              revision(FUNDERHUB_SOURCE, mergePatch, FUNDERHUB_SEED),
            ),
        }),
      }),
    );
    const tokens = new PartialTokenProvider({ funderhub: "funderhub-token" }, ["portal"]);

    const result = await syncToTargets(
      {
        registry: "org:us:ein",
        id: AGILE_SIX_EIN,
        path: "socials.website",
        value: "https://agile6.com",
        targets: ["portal", "funderhub"],
      },
      { sources: [PORTAL_SOURCE, FUNDERHUB_SOURCE], tokens, fetch },
    );

    const portal = result.results.find((entry) => entry.id === "portal");
    expect(portal?.ok).toBe(false);
    expect(portal?.status).toBeNull();
    expect(portal?.message.toLowerCase()).toContain("connect");

    const funderhub = result.results.find((entry) => entry.id === "funderhub");
    expect(funderhub).toEqual({
      id: "funderhub",
      ok: true,
      status: 200,
      message: "Change applied",
    });

    expect(calls.some((request) => request.url.startsWith("https://portal.example.com"))).toBe(
      false,
    );
  });
});

describe("syncToTargets and capabilities", () => {
  it("refuses a target that declares it cannot be written to, without sending it anything", async () => {
    // `capabilities` is the source's own statement about itself. Asking anyway
    // and letting it refuse would make the declaration decorative — and on a
    // system that happened to accept the write, wrong.
    const readOnly: SourceConfig = {
      ...FUNDERHUB_SOURCE,
      capabilities: { read: true, write: false },
    };
    const { fetch, calls } = captureFetch(
      stubFetchByOrigin({ "https://funderhub.example.com": listEnvelope([FUNDERHUB_SEED]) }),
    );

    const { results } = await syncToTargets(
      {
        registry: "org:us:ein",
        id: AGILE_SIX_EIN,
        path: "addresses.primary",
        value: PORTAL_SEED.addresses?.primary as JsonObject,
        targets: ["funderhub"],
      },
      {
        sources: [readOnly],
        tokens: new StaticTokenProvider({ funderhub: "funderhub-token" }),
        fetch,
      },
    );

    expect(results[0]).toMatchObject({ id: "funderhub", ok: false, status: null });
    expect(results[0]?.message).toContain("does not accept changes");
    expect(calls).toHaveLength(0);
  });

  it("writes to a target that declares it can be, so the default is not a blanket refusal", async () => {
    const writable: SourceConfig = {
      ...FUNDERHUB_SOURCE,
      capabilities: { read: true, write: true },
    };
    const fetch = stubFetchByOrigin({
      "https://funderhub.example.com": respondByMethod({
        get: () => listEnvelope([FUNDERHUB_SEED]),
        patch: () =>
          revisionEnvelope("Change applied", revision(writable, { mission: "x" }, FUNDERHUB_SEED)),
      }),
    });

    const { results } = await syncToTargets(
      {
        registry: "org:us:ein",
        id: AGILE_SIX_EIN,
        path: "addresses.primary",
        value: PORTAL_SEED.addresses?.primary as JsonObject,
        targets: ["funderhub"],
      },
      {
        sources: [writable],
        tokens: new StaticTokenProvider({ funderhub: "funderhub-token" }),
        fetch,
      },
    );

    expect(results[0]).toMatchObject({ id: "funderhub", ok: true });
  });
});

describe("compareAcrossSources and capabilities", () => {
  it("carries each source's declared capabilities onto its resolution", async () => {
    const readOnly: SourceConfig = { ...PORTAL_SOURCE, capabilities: { read: true, write: false } };
    const readWrite: SourceConfig = {
      ...FUNDERHUB_SOURCE,
      capabilities: { read: true, write: true },
    };
    const fetch = stubFetchByOrigin({
      "https://portal.example.com": listEnvelope([PORTAL_SEED]),
      "https://funderhub.example.com": listEnvelope([FUNDERHUB_SEED]),
    });
    const tokens = new StaticTokenProvider({
      portal: "portal-token",
      funderhub: "funderhub-token",
    });

    const result = await compareAcrossSources("org:us:ein", AGILE_SIX_EIN, {
      sources: [readOnly, readWrite],
      tokens,
      fetch,
    });

    const portal = result.sources.find((source) => source.id === "portal");
    expect(portal?.capabilities).toEqual({ read: true, write: false });

    const funderhub = result.sources.find((source) => source.id === "funderhub");
    expect(funderhub?.capabilities).toEqual({ read: true, write: true });
  });

  it("defaults an undeclared capability to read and write", async () => {
    const fetch = stubFetchByOrigin({
      "https://portal.example.com": listEnvelope([PORTAL_SEED]),
    });
    const tokens = new StaticTokenProvider({ portal: "portal-token" });

    const result = await compareAcrossSources("org:us:ein", AGILE_SIX_EIN, {
      sources: [PORTAL_SOURCE],
      tokens,
      fetch,
    });

    const portal = result.sources.find((source) => source.id === "portal");
    expect(portal?.capabilities).toEqual({ read: true, write: true });
  });

  it("reports capabilities even for a source that contributed nothing", async () => {
    const fetch = stubFetchByOrigin({
      "https://portal.example.com": errorEnvelope(401, "GrantPortal rejected the request."),
    });
    const tokens = new StaticTokenProvider({ portal: "portal-token" });

    const result = await compareAcrossSources("org:us:ein", AGILE_SIX_EIN, {
      sources: [PORTAL_SOURCE],
      tokens,
      fetch,
    });

    const portal = result.sources.find((source) => source.id === "portal");
    expect(typeof portal?.error).toBe("string");
    expect(portal?.capabilities).toEqual({ read: true, write: true });
  });
});
