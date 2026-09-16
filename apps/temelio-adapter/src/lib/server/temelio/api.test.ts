import { describe, expect, it } from "vitest";
import type { TemelioHttpApiOptions } from "./api.js";
import { TemelioApiError, TemelioHttpApi } from "./api.js";

const ORIGIN = "https://temelio.example.com";
const FOUNDATION_ID = "foundation-1";
const API_KEY = "test-api-key";
const ALLOWED_ID = "nonprofit-allowed";
const OUTSIDE_ID = "nonprofit-outside-allowlist";

const METADATA_URL = `${ORIGIN}/api/foundation/${FOUNDATION_ID}/nonprofit/${ALLOWED_ID}/metadata`;
const SEARCH_URL = `${ORIGIN}/api/foundations/${FOUNDATION_ID}/nonprofits/search`;

/** The record `GET .../metadata` responds with — no envelope, the record is the whole body. */
const FULL_RECORD = {
  nonprofitId: ALLOWED_ID,
  legalName: "Agile Six Applications, Inc.",
  ein: "123456789",
  mission: "Modernize how government serves the public.",
  website: "http://www.agile6.com",
  foundingDate: "2015-01-01",
  orgEmail: "hello@agile6.com",
  phoneNumber: "+1 619-555-0142",
  headquarters: {
    address1: "600 B Street",
    address2: "Suite 210",
    city: "San Diego",
    state: "CA",
    zipcode: "92101",
    country: "US",
  },
  mailingAddress: null,
  dba: "",
  vision: "",
  description: "",
  guidestarProfile: "",
  legalStatus: "501(c)3",
  irsRecipientStatus: "",
  entityType: "ORGANIZATION",
  active: true,
  created: "2026-01-01T00:00:00Z",
};

/** The same record as Temelio would actually send it — carrying funder-side keys the adapter never maps. */
const RECORD_WITH_FUNDER_KEYS = {
  ...FULL_RECORD,
  tags: ["priority"],
  totalAwarded: 50000,
  foundationPOC: "someone@example.org",
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

/** A `fetch` stub that rejects, simulating a network failure rather than a response. */
function failingFetch(error: Error): { fetch: typeof globalThis.fetch } {
  const fetch: typeof globalThis.fetch = async () => {
    throw error;
  };

  return { fetch };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** `200` with an empty body — how a successful merge-write responds. */
function emptyOkResponse(): Response {
  return new Response("", { status: 200 });
}

/** The vendor's usual error envelope. */
function errorEnvelope(status: number, message: string, errors: unknown[] = []): Response {
  return jsonResponse(status, {
    status,
    message,
    path: `/api/foundation/${FOUNDATION_ID}/nonprofit/${ALLOWED_ID}/metadata`,
    code: "ERROR",
    timestamp: new Date().toISOString(),
    errors,
  });
}

/**
 * The one refusal with no `ApiError` envelope at all — a bare Spring 403, the
 * shape the single-field PATCH route answers with for the API key. `read`'s
 * own 403 (a real `ApiError` envelope, meaning "not visible to this key") is
 * covered separately above and resolves `undefined` rather than throwing;
 * this is the generic parsing behaviour for a body no envelope recognizes.
 */
function bareSpringForbidden(): Response {
  return jsonResponse(403, {
    timestamp: new Date().toISOString(),
    status: 403,
    error: "Forbidden",
    path: `/api/foundation/${FOUNDATION_ID}/nonprofit/${ALLOWED_ID}/field`,
  });
}

function searchResponse(data: readonly unknown[]): Response {
  return jsonResponse(200, {
    data,
    meta: { page: 1, pageSize: 10, totalItems: data.length, totalPages: 1 },
  });
}

function buildOptions(overrides: Partial<TemelioHttpApiOptions> = {}): TemelioHttpApiOptions {
  return {
    origin: ORIGIN,
    foundationId: FOUNDATION_ID,
    apiKey: API_KEY,
    allowlist: [ALLOWED_ID],
    ...overrides,
  };
}

describe("read", () => {
  it("sends a GET carrying the API key and no Authorization header, and resolves the parsed record", async () => {
    const { fetch, calls } = stubFetch(jsonResponse(200, FULL_RECORD));
    const api = new TemelioHttpApi(buildOptions({ fetch }));

    const record = await api.read(ALLOWED_ID);

    expect(calls).toHaveLength(1);
    const request = calls[0];
    expect(request?.method).toBe("GET");
    expect(request?.url).toBe(METADATA_URL);
    expect(request?.headers.get("x-api-key")).toBe(API_KEY);
    expect(request?.headers.get("authorization")).toBeNull();
    expect(record?.website).toBe("http://www.agile6.com");
  });

  it("strips vendor keys the adapter does not map", async () => {
    const { fetch } = stubFetch(jsonResponse(200, RECORD_WITH_FUNDER_KEYS));
    const api = new TemelioHttpApi(buildOptions({ fetch }));

    const record = await api.read(ALLOWED_ID);

    expect(record).toBeDefined();
    const keys = Object.keys(record as Record<string, unknown>);
    expect(keys).not.toContain("tags");
    expect(keys).not.toContain("totalAwarded");
    expect(keys).not.toContain("foundationPOC");
  });

  const notVisible = [
    ["404, the shape an API key gets for a record outside the foundation", 404],
    ["403, the shape a session token gets for the same case", 403],
  ] as const;

  it.each(notVisible)(
    "resolves undefined rather than throwing for a record the foundation cannot see (%s)",
    async (_label, status) => {
      const { fetch } = stubFetch(errorEnvelope(status, "Cannot find nonprofit with metadata"));
      const api = new TemelioHttpApi(buildOptions({ fetch }));

      const record = await api.read(ALLOWED_ID);

      expect(record).toBeUndefined();
    },
  );

  it("throws a TemelioApiError on a 401, carrying the status and the envelope's message", async () => {
    const { fetch } = stubFetch(errorEnvelope(401, "Authentication token validation failed"));
    const api = new TemelioHttpApi(buildOptions({ fetch }));

    try {
      await api.read(ALLOWED_ID);
      expect.unreachable("api.read should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(TemelioApiError);
      const apiError = error as TemelioApiError;
      expect(apiError.status).toBe(401);
      expect(apiError.message).toBe("Authentication token validation failed");
    }
  });

  it("throws a TemelioApiError on a 500", async () => {
    const { fetch } = stubFetch(errorEnvelope(500, "Internal server error"));
    const api = new TemelioHttpApi(buildOptions({ fetch }));

    await expect(api.read(ALLOWED_ID)).rejects.toBeInstanceOf(TemelioApiError);
  });

  it("throws a TemelioApiError with an undefined status when the transport itself rejects", async () => {
    const { fetch } = failingFetch(new TypeError("fetch failed"));
    const api = new TemelioHttpApi(buildOptions({ fetch }));

    try {
      await api.read(ALLOWED_ID);
      expect.unreachable("api.read should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(TemelioApiError);
      expect((error as TemelioApiError).status).toBeUndefined();
    }
  });

  it("throws a TemelioApiError when the body is not a record the schema accepts", async () => {
    const withoutId: Record<string, unknown> = { ...FULL_RECORD };
    delete withoutId["nonprofitId"];

    const { fetch } = stubFetch(jsonResponse(200, withoutId));
    const api = new TemelioHttpApi(buildOptions({ fetch }));

    await expect(api.read(ALLOWED_ID)).rejects.toBeInstanceOf(TemelioApiError);
  });

  it("is not guarded by the allowlist", async () => {
    const { fetch, calls } = stubFetch(
      jsonResponse(200, { ...FULL_RECORD, nonprofitId: OUTSIDE_ID }),
    );
    const api = new TemelioHttpApi(buildOptions({ fetch }));

    await api.read(OUTSIDE_ID);

    expect(calls).toHaveLength(1);
  });
});

describe("searchByEin", () => {
  const hit = {
    id: ALLOWED_ID,
    legalName: "Agile Six Applications, Inc.",
    ein: "123456789",
    dba: "",
    entityType: "ORGANIZATION",
    active: true,
    created: "2026-01-01T00:00:00Z",
  };

  it("posts the EIN filter with page 1, and resolves the data array", async () => {
    const { fetch, calls } = stubFetch(searchResponse([hit]));
    const api = new TemelioHttpApi(buildOptions({ fetch }));

    const results = await api.searchByEin("123456789");

    expect(calls).toHaveLength(1);
    const request = calls[0];
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe(SEARCH_URL);
    expect(request?.headers.get("x-api-key")).toBe(API_KEY);
    expect(await request?.json()).toMatchObject({
      page: 1,
      filters: [{ fieldType: "STRING", field: "ein", operator: "EQ", value: "123456789" }],
    });
    expect(results).toEqual([hit]);
  });

  it("resolves an empty array for a miss", async () => {
    const { fetch } = stubFetch(searchResponse([]));
    const api = new TemelioHttpApi(buildOptions({ fetch }));

    const results = await api.searchByEin("000000000");

    expect(results).toEqual([]);
  });

  it("is not guarded by the allowlist", async () => {
    const { fetch, calls } = stubFetch(searchResponse([{ ...hit, id: OUTSIDE_ID }]));
    const api = new TemelioHttpApi(buildOptions({ fetch }));

    await api.searchByEin("123456789");

    expect(calls).toHaveLength(1);
  });
});

describe("write", () => {
  it("posts nonprofitId in the body alongside the patch, and resolves without parsing the empty response", async () => {
    const { fetch, calls } = stubFetch(emptyOkResponse());
    const api = new TemelioHttpApi(buildOptions({ fetch }));

    const result = await api.write(ALLOWED_ID, { website: "https://agile6.com" });

    expect(calls).toHaveLength(1);
    const request = calls[0];
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe(METADATA_URL);
    expect(request?.headers.get("content-type")).toBe("application/json");
    expect(request?.headers.get("x-api-key")).toBe(API_KEY);
    expect(await request?.json()).toEqual({
      nonprofitId: ALLOWED_ID,
      website: "https://agile6.com",
    });
    expect(result).toBeUndefined();
  });

  it("throws before sending any request for a nonprofitId outside the allowlist", async () => {
    const { fetch, calls } = stubFetch(emptyOkResponse());
    const api = new TemelioHttpApi(buildOptions({ fetch }));

    await expect(api.write(OUTSIDE_ID, { website: "https://agile6.com" })).rejects.toBeInstanceOf(
      TemelioApiError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe("TemelioApiError", () => {
  it("carries a usable status and a non-empty message even from a bare Spring body with no message field", async () => {
    const { fetch } = stubFetch(bareSpringForbidden());
    const api = new TemelioHttpApi(buildOptions({ fetch }));

    try {
      await api.write(ALLOWED_ID, { website: "https://agile6.com" });
      expect.unreachable("api.write should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(TemelioApiError);
      const apiError = error as TemelioApiError;
      expect(apiError.status).toBe(403);
      expect(apiError.message.length).toBeGreaterThan(0);
    }
  });
});
