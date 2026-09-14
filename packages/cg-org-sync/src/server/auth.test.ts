import { exportJWK, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { requireAccess, requireBearer } from "./auth.js";
import { loadSigningKey, mintAccessToken } from "./tokens.js";

const EXPECTED_TOKEN = "portal-secret";

/** A request carrying `header` as its `Authorization`, or none when omitted. */
const request = (header?: string) =>
  new Request("https://portal.test/common-grants/orgs", {
    headers: header === undefined ? {} : { Authorization: header },
  });

describe("requireBearer", () => {
  it("rejects a request missing the Authorization header with a 401 envelope", async () => {
    const rejected = requireBearer(request(), EXPECTED_TOKEN);
    const body = await rejected?.json();

    expect(rejected?.status).toBe(401);
    expect(body).toMatchObject({ status: 401 });
  });

  it("returns nothing for a matching token, so the caller proceeds", () => {
    expect(requireBearer(request(`Bearer ${EXPECTED_TOKEN}`), EXPECTED_TOKEN)).toBeUndefined();
  });

  const refused = [
    ["an empty header", ""],
    ["a scheme that is not Bearer", `Basic ${EXPECTED_TOKEN}`],
    ["a token that does not match", "Bearer some-other-token"],
    ["a token with the scheme but no value", "Bearer"],
  ] as const;

  it.each(refused)("rejects %s", (_label, header) => {
    expect(requireBearer(request(header), EXPECTED_TOKEN)?.status).toBe(401);
  });

  it("accepts the scheme in any case, which RFC 7235 says is case-insensitive", () => {
    expect(requireBearer(request(`bearer ${EXPECTED_TOKEN}`), EXPECTED_TOKEN)).toBeUndefined();
  });

  it("fails closed when the system itself has no token configured", () => {
    expect(requireBearer(request(`Bearer ${EXPECTED_TOKEN}`), undefined)?.status).toBe(401);
  });
});

// requireAccess is async — unlike requireBearer, every call site awaits it —
// since it needs to await key generation and JWT verification.
describe("requireAccess", () => {
  const AUDIENCE = "portal";

  /** A fresh ES256 signing key, generated per test so keys never cross tests. */
  const buildKey = async () => {
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    const jwk = await exportJWK(privateKey);
    return loadSigningKey(JSON.stringify(jwk));
  };

  it("resolves a JWT signed by this system's key to the token's own claims", async () => {
    const key = await buildKey();
    const token = await mintAccessToken(key, {
      iss: "portal",
      aud: AUDIENCE,
      sub: "user-1",
      orgs: ["org-1"],
    });

    const principal = await requireAccess(request(`Bearer ${token}`), { key, audience: AUDIENCE });

    expect(principal).toEqual({ sub: "user-1", orgs: ["org-1"] });
  });

  it("resolves the static service token to the service principal, which filters nothing", async () => {
    const key = await buildKey();

    const principal = await requireAccess(request(`Bearer ${EXPECTED_TOKEN}`), {
      key,
      audience: AUDIENCE,
      serviceToken: EXPECTED_TOKEN,
    });

    expect(principal).toEqual({ sub: "service", orgs: "*" });
  });

  it("accepts the service token even when no signing key is configured", async () => {
    const principal = await requireAccess(request(`Bearer ${EXPECTED_TOKEN}`), {
      key: undefined,
      audience: AUDIENCE,
      serviceToken: EXPECTED_TOKEN,
    });

    expect(principal).toEqual({ sub: "service", orgs: "*" });
  });

  it("rejects a JWT signed by a different key with the same 401 envelope as requireBearer", async () => {
    const key = await buildKey();
    const otherKey = await buildKey();
    const token = await mintAccessToken(otherKey, {
      iss: "portal",
      aud: AUDIENCE,
      sub: "user-1",
      orgs: "*",
    });

    const result = await requireAccess(request(`Bearer ${token}`), { key, audience: AUDIENCE });

    if (!(result instanceof Response)) {
      throw new Error("expected a 401 response, got a principal");
    }

    const body = await result.json();

    expect(result.status).toBe(401);
    expect(body).toMatchObject({ status: 401 });
  });

  it("rejects a JWT minted for another system's audience", async () => {
    const key = await buildKey();
    const token = await mintAccessToken(key, {
      iss: "portal",
      aud: "funderhub",
      sub: "user-1",
      orgs: "*",
    });

    const result = await requireAccess(request(`Bearer ${token}`), { key, audience: AUDIENCE });

    expect(result instanceof Response && result.status).toBe(401);
  });

  it("rejects an expired JWT", async () => {
    const key = await buildKey();
    const token = await mintAccessToken(
      key,
      { iss: "portal", aud: AUDIENCE, sub: "user-1", orgs: "*" },
      -10,
    );

    const result = await requireAccess(request(`Bearer ${token}`), { key, audience: AUDIENCE });

    expect(result instanceof Response && result.status).toBe(401);
  });

  it("fails closed when no signing key is configured and the bearer is not the service token", async () => {
    const result = await requireAccess(request(`Bearer not-a-jwt`), {
      key: undefined,
      audience: AUDIENCE,
      serviceToken: EXPECTED_TOKEN,
    });

    expect(result instanceof Response && result.status).toBe(401);
  });

  it("rejects every request when neither a signing key nor a service token is configured", async () => {
    const result = await requireAccess(request(`Bearer ${EXPECTED_TOKEN}`), {
      key: undefined,
      audience: AUDIENCE,
    });

    expect(result instanceof Response && result.status).toBe(401);
  });

  const refused = [
    ["a missing Authorization header", undefined],
    ["an empty header", ""],
    ["a scheme that is not Bearer", `Basic ${EXPECTED_TOKEN}`],
    ["a token with the scheme but no value", "Bearer"],
    ["a bearer that is neither the service token nor a parseable JWT", "Bearer not-a-jwt"],
  ] as const;

  it.each(refused)("rejects %s", async (_label, header) => {
    const key = await buildKey();
    const result = await requireAccess(request(header), {
      key,
      audience: AUDIENCE,
      serviceToken: EXPECTED_TOKEN,
    });

    expect(result instanceof Response && result.status).toBe(401);
  });

  it("accepts the Bearer scheme in any case, matching requireBearer", async () => {
    const principal = await requireAccess(request(`bearer ${EXPECTED_TOKEN}`), {
      key: undefined,
      audience: AUDIENCE,
      serviceToken: EXPECTED_TOKEN,
    });

    expect(principal).toEqual({ sub: "service", orgs: "*" });
  });
});
