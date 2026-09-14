import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import type { AccessTokenClaims, SigningKey } from "./tokens.js";
import {
  createSigningKeyCache,
  jwks,
  loadSigningKey,
  mintAccessToken,
  verifyAccessToken,
} from "./tokens.js";

/** A fresh ES256 signing key, imported the way a system would import its own private JWK. */
async function freshSigningKey(): Promise<SigningKey> {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(privateKey);

  return await loadSigningKey(JSON.stringify(jwk));
}

const portalKey = await freshSigningKey();
const funderhubKey = await freshSigningKey();

describe("loadSigningKey", () => {
  it("imports a real ES256 private JWK and exposes a kid and a public JWK with no private scalar", () => {
    expect(portalKey.kid.length).toBeGreaterThan(0);
    expect(portalKey.publicJwk).not.toHaveProperty("d");
    expect(portalKey.publicJwk.crv).toBe("P-256");
  });

  it("rejects a string that is not JSON", async () => {
    await expect(loadSigningKey("not json")).rejects.toThrow();
  });

  it("rejects a JWK that is not an EC/ES256 key, such as an oct JWK", async () => {
    const octJwk = JSON.stringify({ kty: "oct", k: "c2VjcmV0LWtleQ", alg: "HS256" });

    await expect(loadSigningKey(octJwk)).rejects.toThrow();
  });

  it("yields the same kid for the same JWK, since it is a thumbprint rather than a random id", async () => {
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    const jwk = JSON.stringify(await exportJWK(privateKey));

    const first = await loadSigningKey(jwk);
    const second = await loadSigningKey(jwk);

    expect(second.kid).toBe(first.kid);
  });
});

describe("mintAccessToken / verifyAccessToken", () => {
  it("round-trips a principal minted for one system and verified by the same key", async () => {
    const claims: AccessTokenClaims = {
      iss: "portal",
      aud: "portal",
      sub: "link-widget",
      orgs: ["org-1"],
    };
    const token = await mintAccessToken(portalKey, claims);

    const principal = await verifyAccessToken(portalKey, token, { audience: "portal" });

    expect(principal).toEqual({ sub: "link-widget", orgs: ["org-1"] });
  });

  it('round-trips orgs: "*" as the string, not as an array', async () => {
    const claims: AccessTokenClaims = {
      iss: "portal",
      aud: "portal",
      sub: "link-widget",
      orgs: "*",
    };
    const token = await mintAccessToken(portalKey, claims);

    const principal = await verifyAccessToken(portalKey, token, { audience: "portal" });

    expect(principal.orgs).toBe("*");
  });

  it("rejects a token signed by another system's key", async () => {
    const claims: AccessTokenClaims = {
      iss: "funderhub",
      aud: "portal",
      sub: "link-widget",
      orgs: ["org-1"],
    };
    const token = await mintAccessToken(funderhubKey, claims);

    await expect(verifyAccessToken(portalKey, token, { audience: "portal" })).rejects.toThrow();
  });

  it("rejects a token whose aud does not match the audience being verified against", async () => {
    const claims: AccessTokenClaims = {
      iss: "portal",
      aud: "funderhub",
      sub: "link-widget",
      orgs: ["org-1"],
    };
    const token = await mintAccessToken(portalKey, claims);

    await expect(verifyAccessToken(portalKey, token, { audience: "portal" })).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const claims: AccessTokenClaims = {
      iss: "portal",
      aud: "portal",
      sub: "link-widget",
      orgs: ["org-1"],
    };
    // A zero-second TTL can still land on the same clock second and verify as
    // not-yet-expired, so mint with a negative TTL to guarantee `exp` already
    // reads in the past regardless of timing.
    const token = await mintAccessToken(portalKey, claims, -10);

    await expect(verifyAccessToken(portalKey, token, { audience: "portal" })).rejects.toThrow();
  });

  it("rejects a token whose header kid does not match the key's own kid", async () => {
    const token = await new SignJWT({ sub: "link-widget", orgs: ["org-1"] })
      .setProtectedHeader({ alg: "ES256", kid: "not-the-real-kid" })
      .setIssuedAt()
      .setIssuer("portal")
      .setAudience("portal")
      .setExpirationTime("5m")
      .sign(portalKey.privateKey);

    await expect(verifyAccessToken(portalKey, token, { audience: "portal" })).rejects.toThrow();
  });

  const malformedOrgs = [
    ["the orgs claim is missing entirely", undefined],
    ['orgs is a string other than "*"', "org-1"],
    ["orgs is an array containing a non-string", [1, 2]],
  ] as const;

  it.each(malformedOrgs)("rejects a token where %s", async (_label, orgs) => {
    const payload: Record<string, unknown> = { sub: "link-widget" };
    if (orgs !== undefined) {
      payload["orgs"] = orgs;
    }
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: "ES256", kid: portalKey.kid })
      .setIssuedAt()
      .setIssuer("portal")
      .setAudience("portal")
      .setExpirationTime("5m")
      .sign(portalKey.privateKey);

    await expect(verifyAccessToken(portalKey, token, { audience: "portal" })).rejects.toThrow();
  });
});

describe("jwks", () => {
  it("returns exactly one public ES256 JWK, keyed by kid, with no private scalar", async () => {
    const response = jwks(portalKey);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      keys: [{ kid: portalKey.kid, kty: "EC", crv: "P-256", alg: "ES256", use: "sig" }],
    });
    expect(body.keys[0]).not.toHaveProperty("d");
  });

  it("responds with a JSON content type", () => {
    const response = jwks(portalKey);

    expect(response.headers.get("content-type")).toMatch(/application\/json/);
  });
});

describe("createSigningKeyCache", () => {
  /** A cache plus the problems it reported, so a test can assert on both. */
  function cacheWithLog() {
    const problems: string[] = [];
    const load = createSigningKeyCache((problem) => problems.push(problem));

    return { load, problems };
  }

  const privateJwk = async () => {
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    return JSON.stringify(await exportJWK(privateKey));
  };

  it("resolves to undefined when no key is configured, however many times it is asked", async () => {
    // The unconfigured value is `undefined`, which is also the empty cache's
    // own value — so a cache that compares the two without checking whether it
    // has been populated never populates, and throws on the way out.
    const { load, problems } = cacheWithLog();

    expect(await load(undefined)).toBeUndefined();
    expect(await load(undefined)).toBeUndefined();
    expect(problems).toHaveLength(1);
  });

  it("resolves to undefined and reports a problem when the key is not a private ES256 JWK", async () => {
    const { load, problems } = cacheWithLog();

    expect(await load("not json")).toBeUndefined();
    expect(problems).toHaveLength(1);
  });

  it("imports a configured key and reports nothing", async () => {
    const { load, problems } = cacheWithLog();

    const key = await load(await privateJwk());

    expect(key?.kid.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  it("imports one value once, so repeated requests share the key", async () => {
    const { load } = cacheWithLog();
    const jwk = await privateJwk();

    const [first, second] = [await load(jwk), await load(jwk)];

    expect(second).toBe(first);
  });

  it("re-imports when the configured value changes, rather than serving a stale key", async () => {
    const { load } = cacheWithLog();

    const first = await load(await privateJwk());
    const second = await load(await privateJwk());

    expect(second?.kid).not.toBe(first?.kid);
  });

  it("goes back to undefined if the key is taken away, rather than keeping the old one", async () => {
    const { load } = cacheWithLog();

    await load(await privateJwk());

    expect(await load(undefined)).toBeUndefined();
  });
});
