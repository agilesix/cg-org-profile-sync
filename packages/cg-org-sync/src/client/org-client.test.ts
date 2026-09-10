import {
  AGILE_SIX_EIN,
  FUNDERHUB_ORG_ID,
  FUNDERHUB_UNWRITABLE_FIELDS,
  PORTAL_ORG_ID,
  PORTAL_SEED,
} from "@cg-link/seed";
import { describe, expect, it } from "vitest";
import type { Organization } from "../schemas/index.js";
import type { JsonObject, SourceConfig, TokenProvider } from "../types.js";
import { buildMergePatch } from "../utils/index.js";
import { OrgClient, OrgClientError, StaticTokenProvider } from "./org-client.js";

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

    expect(result).toEqual({ revision: asParsed(accepted), message: "Change applied" });
  });

  it("surfaces a skipped-field message verbatim", async () => {
    const mergePatch = buildMergePatch("yearFounded", 2015);
    const message = `Change applied. This system does not store ${FUNDERHUB_UNWRITABLE_FIELDS.join(", ")}.`;
    const { fetch } = stubFetch(revisionEnvelope(message, revision({})));
    const client = new OrgClient({
      source: SOURCE,
      tokens: new StaticTokenProvider({ portal: "test-token" }),
      fetch,
    });

    const result = await client.patch(FUNDERHUB_ORG_ID, mergePatch);

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

    expect(result).toEqual({ revision: asParsed(minimal), message: "Change applied" });
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
