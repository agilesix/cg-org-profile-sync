import { base64url, exportJWK, generateKeyPair, jwtVerify } from "jose";
import { describe, expect, it, vi } from "vitest";
import { FakeIdentityProvider } from "./identity.js";
import { authorize, callback, token, type OAuthConfig } from "./oauth-routes.js";
import { loadSigningKey, verifyAccessToken, type SigningKey } from "./tokens.js";

const SYSTEM_ID = "portal";
const ISSUER = "https://portal.test";
const LINK_REDIRECT_URI = "https://link.test/oauth/callback";
const GRANTED_EMAIL = "admin@example.org";
const GRANTED_ORG = "org-1";

/** A fresh ES256 signing key, imported the way a system would import its own private JWK. */
async function freshSigningKey(): Promise<SigningKey> {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(privateKey);

  return await loadSigningKey(JSON.stringify(jwk));
}

const portalKey = await freshSigningKey();

/** An `OAuthConfig` for a fake portal, wired to the fake identity provider. */
function buildConfig(key: SigningKey, overrides: Partial<OAuthConfig> = {}): OAuthConfig {
  return {
    key,
    systemId: SYSTEM_ID,
    issuer: ISSUER,
    identity: new FakeIdentityProvider(),
    redirectUris: [LINK_REDIRECT_URI],
    grantsFor: (email) => (email === GRANTED_EMAIL ? [GRANTED_ORG] : []),
    ...overrides,
  };
}

/** The default (valid) query parameters a well-formed `authorize` request carries. */
const AUTHORIZE_PARAMS: Record<string, string> = {
  client_id: "link",
  redirect_uri: LINK_REDIRECT_URI,
  code_challenge: "a-fixed-test-challenge",
  code_challenge_method: "S256",
  state: "link-state-123",
};

/** `GET /oauth/authorize` with `overrides` layered over the defaults; `undefined` omits a param. */
function authorizeUrl(overrides: Record<string, string | undefined> = {}): URL {
  const url = new URL("https://portal.test/oauth/authorize");
  const params = { ...AUTHORIZE_PARAMS, ...overrides };

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  return url;
}

/** The `Response`'s `location` header, parsed as a URL. Throws if there is none. */
function redirectTarget(response: Response): URL {
  const header = response.headers.get("location");

  if (!header) {
    throw new Error("expected a location header, got none");
  }

  return new URL(header);
}

/** Drives `authorize` and pulls the signed portal state out of its redirect. */
async function portalStateFrom(
  config: OAuthConfig,
  overrides: Record<string, string | undefined> = {},
): Promise<string> {
  const response = await authorize(authorizeUrl(overrides), config);
  const state = redirectTarget(response).searchParams.get("state");

  if (!state) {
    throw new Error("authorize did not carry a state");
  }

  return state;
}

/** A PKCE verifier and its S256 challenge, the pair `authorize`/`token` connect. */
async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = "a-fixed-test-verifier";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64url.encode(new Uint8Array(digest));

  return { verifier, challenge };
}

/** Drives `authorize` → `callback` for `email` and returns the resulting authorization code. */
async function codeFor(
  config: OAuthConfig,
  challenge: string,
  email = GRANTED_EMAIL,
): Promise<string> {
  const portalState = await portalStateFrom(config, { code_challenge: challenge });

  const callbackUrl = new URL("https://portal.test/oauth/callback");
  callbackUrl.searchParams.set("state", portalState);
  callbackUrl.searchParams.set("email", email);

  const response = await callback(callbackUrl, config);
  const code = redirectTarget(response).searchParams.get("code");

  if (!code) {
    throw new Error("callback did not carry a code");
  }

  return code;
}

/** A `POST /oauth/token` request with `body` sent as `application/x-www-form-urlencoded`. */
function tokenRequest(body: Record<string, string>): Request {
  return new Request("https://portal.test/oauth/token", {
    method: "POST",
    body: new URLSearchParams(body),
  });
}

describe("authorize", () => {
  it("redirects a well-formed request to the identity provider", async () => {
    const config = buildConfig(portalKey);

    const response = await authorize(authorizeUrl(), config);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBeTruthy();
  });

  it("signs a portal state that carries the code challenge, the redirect_uri, and Link's own state", async () => {
    const config = buildConfig(portalKey);

    const response = await authorize(authorizeUrl(), config);
    const state = redirectTarget(response).searchParams.get("state");
    expect(state).toBeTruthy();

    const { payload } = await jwtVerify(state!, portalKey.publicKey, { algorithms: ["ES256"] });

    expect(payload).toMatchObject({
      code_challenge: AUTHORIZE_PARAMS["code_challenge"],
      redirect_uri: AUTHORIZE_PARAMS["redirect_uri"],
      link_state: AUTHORIZE_PARAMS["state"],
    });
  });

  it("answers 400, rather than redirecting, for a redirect_uri that is not allow-listed", async () => {
    const config = buildConfig(portalKey);

    const response = await authorize(
      authorizeUrl({ redirect_uri: "https://not-allowed.test/callback" }),
      config,
    );

    expect(response.status).toBe(400);
  });

  it("answers 400 for a client_id other than link", async () => {
    const config = buildConfig(portalKey);

    const response = await authorize(authorizeUrl({ client_id: "someone-else" }), config);

    expect(response.status).toBe(400);
  });

  const badPkce = [
    ["a missing code_challenge", { code_challenge: undefined }],
    ["a code_challenge_method that is not S256", { code_challenge_method: "plain" }],
  ] as const;

  it.each(badPkce)("answers 400 for %s", async (_label, overrides) => {
    const config = buildConfig(portalKey);

    const response = await authorize(authorizeUrl(overrides), config);

    expect(response.status).toBe(400);
  });

  it("passes login_hint through to the identity provider's authorize URL", async () => {
    const config = buildConfig(portalKey);

    const response = await authorize(authorizeUrl({ login_hint: GRANTED_EMAIL }), config);

    expect(redirectTarget(response).searchParams.get("login_hint")).toBe(GRANTED_EMAIL);
  });
});

describe("callback", () => {
  it("redirects a person with grants to Link's redirect_uri carrying a code and Link's own state", async () => {
    const config = buildConfig(portalKey);
    const portalState = await portalStateFrom(config);

    const callbackUrl = new URL("https://portal.test/oauth/callback");
    callbackUrl.searchParams.set("state", portalState);
    callbackUrl.searchParams.set("email", GRANTED_EMAIL);

    const response = await callback(callbackUrl, config);
    const redirect = redirectTarget(response);

    expect(`${redirect.origin}${redirect.pathname}`).toBe(LINK_REDIRECT_URI);
    expect(redirect.searchParams.get("code")).toBeTruthy();
    expect(redirect.searchParams.get("state")).toBe(AUTHORIZE_PARAMS["state"]);
  });

  it("redirects with error=access_denied and no code when the email has no grants here", async () => {
    const config = buildConfig(portalKey);
    const portalState = await portalStateFrom(config);

    const callbackUrl = new URL("https://portal.test/oauth/callback");
    callbackUrl.searchParams.set("state", portalState);
    callbackUrl.searchParams.set("email", "stranger@example.org");

    const response = await callback(callbackUrl, config);
    const redirect = redirectTarget(response);

    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("code")).toBeNull();
  });

  it("answers 400 for a state this system did not sign", async () => {
    const config = buildConfig(portalKey);
    const otherKey = await freshSigningKey();
    const foreignState = await portalStateFrom(buildConfig(otherKey));

    const callbackUrl = new URL("https://portal.test/oauth/callback");
    callbackUrl.searchParams.set("state", foreignState);
    callbackUrl.searchParams.set("email", GRANTED_EMAIL);

    const response = await callback(callbackUrl, config);

    expect(response.status).toBe(400);
  });

  it("answers 400 for an expired state", async () => {
    const config = buildConfig(portalKey);
    const portalState = await portalStateFrom(config);

    // The state is a short-lived JWT; there is no TTL to sleep through, so move
    // the clock an hour past "now" instead — comfortably beyond any plausible
    // state TTL — and restore real timers so later tests are unaffected.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);

    try {
      const callbackUrl = new URL("https://portal.test/oauth/callback");
      callbackUrl.searchParams.set("state", portalState);
      callbackUrl.searchParams.set("email", GRANTED_EMAIL);

      const response = await callback(callbackUrl, config);

      expect(response.status).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });

  it("redirects to redirect_uri carrying the provider's own error, rather than answering 200", async () => {
    const config = buildConfig(portalKey);
    const portalState = await portalStateFrom(config);

    const callbackUrl = new URL("https://portal.test/oauth/callback");
    callbackUrl.searchParams.set("state", portalState);
    callbackUrl.searchParams.set("error", "access_denied");

    const response = await callback(callbackUrl, config);
    const redirect = redirectTarget(response);

    expect(response.status).not.toBe(200);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(LINK_REDIRECT_URI);
    expect(redirect.searchParams.get("error")).toBeTruthy();
  });
});

describe("token", () => {
  // The most important test in this file: it drives all three handlers in
  // sequence with the fake identity provider, the way Link's PKCE client
  // actually would, rather than exercising each handler in isolation.
  it("round-trips a person with grants, through authorize, callback, and token, into a T1 access token for their own orgs", async () => {
    const config = buildConfig(portalKey);
    const { verifier, challenge } = await pkcePair();
    const code = await codeFor(config, challenge);

    const response = await token(
      tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: LINK_REDIRECT_URI,
        code_verifier: verifier,
      }),
      config,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ token_type: "Bearer" });
    expect(typeof body.access_token).toBe("string");
    expect(typeof body.expires_in).toBe("number");

    const principal = await verifyAccessToken(portalKey, body.access_token, {
      audience: config.systemId,
    });

    expect(principal).toEqual({ sub: GRANTED_EMAIL, orgs: [GRANTED_ORG] });
  });

  it("answers 400 invalid_grant when the verifier does not hash to the code's challenge", async () => {
    const config = buildConfig(portalKey);
    const { challenge } = await pkcePair();
    const code = await codeFor(config, challenge);

    const response = await token(
      tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: LINK_REDIRECT_URI,
        code_verifier: "not-the-right-verifier",
      }),
      config,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "invalid_grant" });
  });

  it("answers 400 invalid_grant for an expired code", async () => {
    const config = buildConfig(portalKey);
    const { verifier, challenge } = await pkcePair();
    const code = await codeFor(config, challenge);

    // Same reasoning as the expired-state test above: no TTL to sleep through,
    // so jump the clock an hour past "now" instead of waiting it out.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);

    try {
      const response = await token(
        tokenRequest({
          grant_type: "authorization_code",
          code,
          redirect_uri: LINK_REDIRECT_URI,
          code_verifier: verifier,
        }),
        config,
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({ error: "invalid_grant" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers 400 invalid_grant when the redirect_uri differs from the one baked into the code", async () => {
    const config = buildConfig(portalKey);
    const { verifier, challenge } = await pkcePair();
    const code = await codeFor(config, challenge);

    const response = await token(
      tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: "https://link.test/other-callback",
        code_verifier: verifier,
      }),
      config,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "invalid_grant" });
  });

  it("answers 400 invalid_grant for a code that is not a JWT this system signed", async () => {
    const config = buildConfig(portalKey);

    const response = await token(
      tokenRequest({
        grant_type: "authorization_code",
        code: "not-a-jwt",
        redirect_uri: LINK_REDIRECT_URI,
        code_verifier: "irrelevant",
      }),
      config,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "invalid_grant" });
  });

  it("refuses to verify an authorization code as an access token, since only the audience separates them", async () => {
    const config = buildConfig(portalKey);
    const { challenge } = await pkcePair();
    const code = await codeFor(config, challenge);

    await expect(
      verifyAccessToken(portalKey, code, { audience: config.systemId }),
    ).rejects.toThrow();
  });
});

describe("origin handling", () => {
  // `issuer` comes from a hand-edited environment variable, and a trailing
  // slash is the commonest way to mistype an origin. It matters more than it
  // looks: the callback URL built from it is the `redirect_uri` Google matches
  // against its registered list exactly, so one stray slash fails the real
  // provider with nothing in the request to explain it.
  it("builds the same provider URL whether or not the issuer carries a trailing slash", async () => {
    const plain = buildConfig(portalKey, { issuer: "https://portal.test" });
    const slashed = buildConfig(portalKey, { issuer: "https://portal.test/" });

    const fromPlain = redirectTarget(await authorize(authorizeUrl(), plain));
    const fromSlashed = redirectTarget(await authorize(authorizeUrl(), slashed));

    expect(fromSlashed.pathname).toBe(fromPlain.pathname);
    expect(fromSlashed.pathname).toBe("/oauth/fake-login");
  });
});
