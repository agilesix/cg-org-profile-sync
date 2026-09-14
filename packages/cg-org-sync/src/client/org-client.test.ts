import { AGILE_SIX_EIN, FUNDERHUB_SEED, PORTAL_ORG_ID, PORTAL_SEED } from "@cg-link/seed";
import { describe, expect, it } from "vitest";
import type { Organization } from "../schemas/index.js";
import type { JsonObject, SourceConfig, TokenProvider } from "../types.js";
import { buildMergePatch } from "../utils/index.js";
import {
  NotConnectedError,
  OrgClient,
  OrgClientError,
  SOURCE_TOKENS_HEADER,
  sourceTokensHeader,
  StaticTokenProvider,
  tokensFromHeader,
} from "./org-client.js";

const SOURCE: SourceConfig = {
  id: "portal",
  label: "GrantPortal",
  baseUrl: "https://portal.example.com",
  tokenUrl: "https://portal.example.com/token",
};

/** A `fetch` stub that returns a canned `Response` and records the `Request`s it saw. */
function stubFetch(response: Response): { fetch: typeof globalThis.fetch; calls: Request[] } {
  const calls: Request[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push(new Request(input, init));
    return response;
  };

  return { fetch, calls };
}

/** The paginated envelope `GET /common-grants/orgs` responds with. */
function envelope(items: readonly Organization[]): Response {
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

/** The single-resource envelope `GET /common-grants/orgs/{orgId}` responds with. */
function okEnvelope(data: Organization): Response {
  return new Response(JSON.stringify({ status: 200, message: "Success", data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** The revision record `PATCH /common-grants/orgs/{orgId}` reports the change as. */
function revision(patch: JsonObject): JsonObject {
  const now = new Date().toISOString();

  return {
    id: "018f2e77-1a2b-7c3d-8e4f-000000000099",
    status: { value: "accepted", description: "The change was applied." },
    source: SOURCE.id,
    patch,
    snapshot: PORTAL_SEED as unknown as JsonObject,
    createdAt: now,
    lastModifiedAt: now,
  };
}

/**
 * The same revision as it looks once parsed.
 *
 * `RecordTimestampsSchema` uses the SDK's `UTCDateTimeSchema`, which is a
 * `ZodTransform<Date, string>` — it parses an ISO string into a `Date`. So a
 * parsed revision is deliberately not `toEqual` its own wire form.
 */
function asParsed(wire: JsonObject): Record<string, unknown> {
  return {
    ...wire,
    createdAt: new Date(String(wire["createdAt"])),
    lastModifiedAt: new Date(String(wire["lastModifiedAt"])),
  };
}

/** The single-resource envelope `PATCH /common-grants/orgs/{orgId}` responds with. */
function revisionEnvelope(message: string, data: JsonObject): Response {
  return new Response(JSON.stringify({ status: 200, message, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** The error envelope `Responses.Error` — see `src/server/responses.ts:failure`. */
function errorEnvelope(status: number, message: string, errors: unknown[] = []): Response {
  return new Response(JSON.stringify({ status, message, errors }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A `fetch` stub that rejects, simulating a network failure rather than a response. */
function failingFetch(error: Error): { fetch: typeof globalThis.fetch } {
  const fetch: typeof globalThis.fetch = async () => {
    throw error;
  };

  return { fetch };
}

/** A `Request` carrying the source-tokens header, as Link's own API would receive it. */
function requestWithTokens(header: string): Request {
  return new Request("https://link.test/api/compare", {
    headers: { [SOURCE_TOKENS_HEADER]: header },
  });
}

describe("findByIdentifier", () => {
  it("returns the first matching organization, unwrapped from the paginated envelope", async () => {
    const { fetch } = stubFetch(envelope([PORTAL_SEED]));
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    const org = await client.findByIdentifier("org:us:ein", AGILE_SIX_EIN);

    expect(org).toEqual(PORTAL_SEED);
  });

  it("resolves to undefined when no organization carries the identifier", async () => {
    const { fetch } = stubFetch(envelope([]));
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    const org = await client.findByIdentifier("org:us:ein", "000000000");

    expect(org).toBeUndefined();
  });

  it("returns the first of several matching organizations", async () => {
    const other = structuredClone(PORTAL_SEED);
    other.id = "018f2e77-1a2b-7c3d-8e4f-000000000099";
    const { fetch } = stubFetch(envelope([PORTAL_SEED, other]));
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    const org = await client.findByIdentifier("org:us:ein", AGILE_SIX_EIN);

    expect(org?.id).toBe(PORTAL_ORG_ID);
  });

  it("requests the identifier lookup with a bearer token from the token provider", async () => {
    const { fetch, calls } = stubFetch(envelope([]));
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    await client.findByIdentifier("org:us:ein", AGILE_SIX_EIN);

    expect(calls).toHaveLength(1);
    const request = calls[0];
    const url = new URL(request?.url ?? "");

    expect(url.origin + url.pathname).toBe("https://portal.example.com/common-grants/orgs");
    expect(url.searchParams.get("registry")).toBe("org:us:ein");
    expect(url.searchParams.get("id")).toBe(AGILE_SIX_EIN);
    expect(request?.headers.get("authorization")).toBe("Bearer test-token");
  });
});

describe("list", () => {
  it("requests every org with no registry or id query parameters, carrying a bearer token", async () => {
    const { fetch, calls } = stubFetch(envelope([]));
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    await client.list();

    expect(calls).toHaveLength(1);
    const request = calls[0];
    const url = new URL(request?.url ?? "");

    expect(url.origin + url.pathname).toBe("https://portal.example.com/common-grants/orgs");
    expect(url.searchParams.get("registry")).toBeNull();
    expect(url.searchParams.get("id")).toBeNull();
    expect(request?.headers.get("authorization")).toBe("Bearer test-token");
  });

  it("returns every organization from the paginated envelope, in order", async () => {
    const { fetch } = stubFetch(envelope([PORTAL_SEED, FUNDERHUB_SEED]));
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    const orgs = await client.list();

    expect(orgs.map((org) => org.id)).toEqual([PORTAL_SEED.id, FUNDERHUB_SEED.id]);
    expect(orgs.map((org) => org.name)).toEqual([PORTAL_SEED.name, FUNDERHUB_SEED.name]);
  });

  it("returns an empty array when the source holds no orgs, rather than an error", async () => {
    const { fetch } = stubFetch(envelope([]));
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    const orgs = await client.list();

    expect(orgs).toEqual([]);
  });

  it("throws an OrgClientError when the envelope carries no items array", async () => {
    const response = new Response(JSON.stringify({ status: 200, message: "Success" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const { fetch } = stubFetch(response);
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    try {
      await client.list();
      expect.unreachable("client.list should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(OrgClientError);
      const orgClientError = error as OrgClientError;
      expect(orgClientError.sourceId).toBe(SOURCE.id);
    }
  });

  it("throws an OrgClientError with the envelope's status and message on a refusal", async () => {
    const { fetch } = stubFetch(errorEnvelope(403, "This token is not scoped to that org.", []));
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    try {
      await client.list();
      expect.unreachable("client.list should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(OrgClientError);
      const orgClientError = error as OrgClientError;
      expect(orgClientError.sourceId).toBe(SOURCE.id);
      expect(orgClientError.status).toBe(403);
      expect(orgClientError.message).toBe("This token is not scoped to that org.");
    }
  });

  it("throws an OrgClientError when an item fails schema validation", async () => {
    const broken = structuredClone(PORTAL_SEED) as unknown as Record<string, unknown>;
    delete broken.name;
    const { fetch } = stubFetch(envelope([broken as unknown as Organization]));
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    try {
      await client.list();
      expect.unreachable("client.list should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(OrgClientError);
      const orgClientError = error as OrgClientError;
      expect(orgClientError.errors.length).toBeGreaterThan(0);
    }
  });

  it("throws NotConnectedError and sends no request when there is no token for this source", async () => {
    const { fetch, calls } = stubFetch(envelope([]));
    const client = new OrgClient({ source: SOURCE, tokens: new StaticTokenProvider({}), fetch });

    await expect(client.list()).rejects.toBeInstanceOf(NotConnectedError);
    expect(calls).toHaveLength(0);
  });
});

describe("read", () => {
  it("returns the Organization from the data field", async () => {
    const { fetch } = stubFetch(okEnvelope(PORTAL_SEED));
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    const org = await client.read(PORTAL_ORG_ID);

    expect(org).toEqual(PORTAL_SEED);
  });

  it("requests the org by id with a bearer token from the token provider", async () => {
    const { fetch, calls } = stubFetch(okEnvelope(PORTAL_SEED));
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    await client.read(PORTAL_ORG_ID);

    expect(calls).toHaveLength(1);
    const request = calls[0];
    const url = new URL(request?.url ?? "");

    expect(url.origin + url.pathname).toBe(
      `https://portal.example.com/common-grants/orgs/${PORTAL_ORG_ID}`,
    );
    expect(request?.headers.get("authorization")).toBe("Bearer test-token");
  });
});

describe("patch", () => {
  it("returns the revision and message from the update envelope", async () => {
    const mergePatch = buildMergePatch("name", "Agile Six Applications, Inc.");
    const accepted = revision(mergePatch);
    const { fetch } = stubFetch(revisionEnvelope("Change applied", accepted));
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    const result = await client.patch(PORTAL_ORG_ID, mergePatch);

    expect(result).toEqual({
      revision: asParsed(accepted),
      message: "Change applied",
      status: 200,
    });
  });

  it("surfaces a skipped-field message verbatim", async () => {
    // The client does not decide what a source will store, so the source here
    // is the same one every other case uses; only the sentence coming back is
    // the subject. It is worded the way a declining system words it.
    const mergePatch = buildMergePatch("yearFounded", 2015);
    const message = "Change applied. This system does not store yearFounded.";
    const { fetch } = stubFetch(revisionEnvelope(message, revision({})));
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    const result = await client.patch(PORTAL_ORG_ID, mergePatch);

    expect(result.message).toBe(message);
  });

  it("sends the merge patch as a PATCH request with the merge-patch content type and bearer token", async () => {
    const mergePatch = buildMergePatch("name", "Agile Six Applications, Inc.");
    const { fetch, calls } = stubFetch(revisionEnvelope("Change applied", revision(mergePatch)));
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    await client.patch(PORTAL_ORG_ID, mergePatch);

    expect(calls).toHaveLength(1);
    const request = calls[0];
    const url = new URL(request?.url ?? "");

    expect(request?.method).toBe("PATCH");
    expect(url.origin + url.pathname).toBe(
      `https://portal.example.com/common-grants/orgs/${PORTAL_ORG_ID}`,
    );
    expect(request?.headers.get("content-type")).toBe("application/merge-patch+json");
    expect(request?.headers.get("authorization")).toBe("Bearer test-token");
    expect(await request?.json()).toEqual(mergePatch);
  });

  it("rejects a revision missing a spec-required field", async () => {
    const mergePatch = buildMergePatch("name", "Agile Six Applications, Inc.");
    const broken = revision(mergePatch) as Record<string, unknown>;
    delete broken.id;
    const { fetch } = stubFetch(revisionEnvelope("Change applied", broken as JsonObject));
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    try {
      await client.patch(PORTAL_ORG_ID, mergePatch);
      expect.unreachable("client.patch should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(OrgClientError);
      const orgClientError = error as OrgClientError;
      expect(orgClientError.errors.length).toBeGreaterThan(0);
    }
  });

  it("rejects a revision whose status is not one of the recognized values", async () => {
    const mergePatch = buildMergePatch("name", "Agile Six Applications, Inc.");
    const invalid = {
      ...revision(mergePatch),
      status: { value: "maybe", description: "Not a real status." },
    };
    const { fetch } = stubFetch(revisionEnvelope("Change applied", invalid));
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    await expect(client.patch(PORTAL_ORG_ID, mergePatch)).rejects.toThrow(OrgClientError);
  });

  it("reports the revision's schema issues when the message is missing too", async () => {
    const mergePatch = buildMergePatch("name", "Agile Six Applications, Inc.");
    const withoutId = revision(mergePatch);
    delete withoutId["id"];
    const response = new Response(JSON.stringify({ status: 200, data: withoutId }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const { fetch } = stubFetch(response);
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    try {
      await client.patch(PORTAL_ORG_ID, mergePatch);
      expect.unreachable("client.patch should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(OrgClientError);
      expect((error as OrgClientError).errors.length).toBeGreaterThan(0);
    }
  });

  it("accepts a revision that omits the optional source, patch, and snapshot fields", async () => {
    const mergePatch = buildMergePatch("name", "Agile Six Applications, Inc.");
    const now = new Date().toISOString();
    const minimal: JsonObject = {
      id: "018f2e77-1a2b-7c3d-8e4f-000000000099",
      status: { value: "accepted" },
      createdAt: now,
      lastModifiedAt: now,
    };
    const { fetch } = stubFetch(revisionEnvelope("Change applied", minimal));
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    const result = await client.patch(PORTAL_ORG_ID, mergePatch);

    expect(result).toEqual({
      revision: asParsed(minimal),
      message: "Change applied",
      status: 200,
    });
  });
});

describe("OrgClientError", () => {
  it("is thrown with the envelope's status, message, and errors on a failed read", async () => {
    const { fetch } = stubFetch(
      errorEnvelope(404, "The server cannot find the requested resource.", [
        { path: "id", message: "No org with that id." },
      ]),
    );
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    try {
      await client.read(PORTAL_ORG_ID);
      expect.unreachable("client.read should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(OrgClientError);
      const orgClientError = error as OrgClientError;
      expect(orgClientError.sourceId).toBe(SOURCE.id);
      expect(orgClientError.status).toBe(404);
      expect(orgClientError.message).toBe("The server cannot find the requested resource.");
      expect(orgClientError.errors).toEqual([{ path: "id", message: "No org with that id." }]);
    }
  });

  it("surfaces a 401 with that status, distinct from not found", async () => {
    const { fetch } = stubFetch(
      errorEnvelope(401, "That access token is not valid for this system.", []),
    );
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    await expect(client.read(PORTAL_ORG_ID)).rejects.toMatchObject({
      status: 401,
      message: "That access token is not valid for this system.",
    });
  });

  it("attaches the source id and an undefined status on a network failure", async () => {
    const { fetch } = failingFetch(new TypeError("fetch failed"));
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    try {
      await client.read(PORTAL_ORG_ID);
      expect.unreachable("client.read should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(OrgClientError);
      const orgClientError = error as OrgClientError;
      expect(orgClientError.sourceId).toBe(SOURCE.id);
      expect(orgClientError.status).toBeUndefined();
    }
  });

  it("rejects with an OrgClientError when the body carries no recognizable envelope", async () => {
    const response = new Response(JSON.stringify({ hello: "world" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const { fetch } = stubFetch(response);
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    await expect(client.read(PORTAL_ORG_ID)).rejects.toThrow(OrgClientError);
  });

  it("rejects with an OrgClientError when the envelope's data fails schema validation", async () => {
    const broken = structuredClone(PORTAL_SEED) as unknown as Record<string, unknown>;
    delete broken.name;
    const { fetch } = stubFetch(okEnvelope(broken as unknown as Organization));
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    await expect(client.read(PORTAL_ORG_ID)).rejects.toThrow(OrgClientError);
  });

  it("rejects a patch with the same typed error on an error envelope", async () => {
    const mergePatch = buildMergePatch("name", "Agile Six Applications, Inc.");
    const { fetch } = stubFetch(
      errorEnvelope(400, "This patch is not a valid JSON Merge Patch.", []),
    );
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    try {
      await client.patch(PORTAL_ORG_ID, mergePatch);
      expect.unreachable("client.patch should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(OrgClientError);
      const orgClientError = error as OrgClientError;
      expect(orgClientError.sourceId).toBe(SOURCE.id);
      expect(orgClientError.status).toBe(400);
      expect(orgClientError.message).toBe("This patch is not a valid JSON Merge Patch.");
    }
  });
  it("wraps a token provider that fails with something other than an OrgClientError", async () => {
    const tokens: TokenProvider = {
      tokenFor: async () => {
        throw new Error("the token endpoint is down");
      },
    };
    const { fetch } = stubFetch(okEnvelope(PORTAL_SEED));
    const client = new OrgClient({ source: SOURCE, tokens, fetch });

    try {
      await client.read(PORTAL_ORG_ID);
      expect.unreachable("client.read should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(OrgClientError);
      const orgClientError = error as OrgClientError;
      expect(orgClientError.sourceId).toBe(SOURCE.id);
      expect(orgClientError.status).toBeUndefined();
      expect(orgClientError.cause).toBeInstanceOf(Error);
    }
  });

  it("rejects when the transport resolves something that is not a Response", async () => {
    const fetch = (async () => undefined) as unknown as typeof globalThis.fetch;
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    await expect(client.read(PORTAL_ORG_ID)).rejects.toThrow(OrgClientError);
  });
});

describe("sourceTokensHeader / tokensFromHeader round trip", () => {
  it("round-trips a token per source", async () => {
    const header = sourceTokensHeader({ portal: "token-a", funderhub: "token-b" });
    const tokens = tokensFromHeader(requestWithTokens(header));

    expect(await tokens.tokenFor("portal")).toBe("token-a");
    expect(await tokens.tokenFor("funderhub")).toBe("token-b");
  });

  it("round-trips an empty map to a provider that grants nothing", async () => {
    const header = sourceTokensHeader({});
    const tokens = tokensFromHeader(requestWithTokens(header));

    await expect(tokens.tokenFor("portal")).rejects.toBeInstanceOf(NotConnectedError);
  });

  it("round-trips a realistic JWT, dots and base64url characters intact", async () => {
    const jwt =
      "eyJhbGciOiJFUzI1NiIsImtpZCI6ImFiYyJ9.eyJzdWIiOiJwZXJzb24tMSIsIm9yZ3MiOiIqIn0.MEUCIQD-_9AbC12z3";
    const header = sourceTokensHeader({ portal: jwt });
    const tokens = tokensFromHeader(requestWithTokens(header));

    expect(await tokens.tokenFor("portal")).toBe(jwt);
  });
});

describe("tokensFromHeader", () => {
  it("treats a request with no source-tokens header as connected to nothing", async () => {
    const request = new Request("https://link.test/api/compare");
    const tokens = tokensFromHeader(request);

    await expect(tokens.tokenFor("portal")).rejects.toBeInstanceOf(NotConnectedError);
  });

  it("rejects a source the header does not name with NotConnectedError", async () => {
    const tokens = tokensFromHeader(requestWithTokens("funderhub=token-b"));

    await expect(tokens.tokenFor("portal")).rejects.toThrow(NotConnectedError);
  });

  it("NotConnectedError is also an OrgClientError, carrying the source id", async () => {
    const tokens = tokensFromHeader(requestWithTokens("funderhub=token-b"));

    try {
      await tokens.tokenFor("portal");
      expect.unreachable("tokenFor should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(OrgClientError);
      expect(error).toBeInstanceOf(NotConnectedError);
      expect((error as NotConnectedError).sourceId).toBe("portal");
    }
  });

  it("tolerates whitespace around entries and around the =", async () => {
    const tokens = tokensFromHeader(requestWithTokens("portal = token-a , funderhub = token-b"));

    expect(await tokens.tokenFor("portal")).toBe("token-a");
    expect(await tokens.tokenFor("funderhub")).toBe("token-b");
  });

  const malformedEntries = [
    ["no `=` separator", "malformed"],
    ["an empty key", "=token-b"],
    ["an empty value", "funderhub="],
  ] as const;

  it.each(malformedEntries)(
    "drops only the malformed entry (%s) rather than failing the whole header, since the other sources' columns still have to render",
    async (_label, malformedEntry) => {
      const tokens = tokensFromHeader(requestWithTokens(`portal=token-a, ${malformedEntry}`));

      expect(await tokens.tokenFor("portal")).toBe("token-a");
      await expect(tokens.tokenFor("funderhub")).rejects.toBeInstanceOf(NotConnectedError);
    },
  );

  it("keeps a value containing = whole, splitting only on the first", async () => {
    const tokens = tokensFromHeader(requestWithTokens("portal=part1=part2"));

    expect(await tokens.tokenFor("portal")).toBe("part1=part2");
  });

  // Repeated header parameters conventionally resolve to the last one seen, so
  // that is what a repeated source name resolves to here too.
  it("resolves a repeated source to the last token in the header", async () => {
    const tokens = tokensFromHeader(requestWithTokens("portal=first, portal=second"));

    expect(await tokens.tokenFor("portal")).toBe("second");
  });
});
