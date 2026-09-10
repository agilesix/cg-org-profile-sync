import {
  AGILE_SIX_EIN,
  FUNDERHUB_ORG_ID,
  FUNDERHUB_SEED,
  PORTAL_ORG_ID,
  PORTAL_SEED,
} from "@cg-link/seed";
import { describe, expect, it } from "vitest";
import type { Organization } from "../schemas/index.js";
import type { JsonObject, SourceConfig } from "../types.js";
import { DEMO_FIELDS, buildMergePatch } from "../utils/index.js";
import { StaticTokenProvider } from "./org-client.js";
import { compareAcrossSources, syncToTargets } from "./fanout.js";

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

/** The error envelope a rejected request's body carries. */
function errorEnvelope(status: number, message: string): Response {
  return new Response(JSON.stringify({ status, message, errors: [] }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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

    expect(result.sources).toEqual([
      { id: "portal", label: "GrantPortal", orgId: PORTAL_ORG_ID },
      { id: "funderhub", label: "FunderHub", orgId: FUNDERHUB_ORG_ID },
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
});
