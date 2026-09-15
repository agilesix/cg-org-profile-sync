import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { FakeIdentityProvider, fakeLoginPage, GoogleIdentityProvider } from "./identity.js";
import type { IdentityProvider } from "./identity.js";

const CLIENT_ID = "link";
const CLIENT_SECRET = "test-client-secret";
const CALLBACK_URL = "https://portal.test/oauth/callback";

/** A `fetch` stub that returns a canned `Response` and records the `Request`s it saw. */
function stubFetch(response: Response): { fetch: typeof globalThis.fetch; calls: Request[] } {
  const calls: Request[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push(new Request(input, init));
    return response;
  };

  return { fetch, calls };
}

/** The JSON body Google's token endpoint answers a successful exchange with. */
function tokenResponse(idToken: string): Response {
  return new Response(JSON.stringify({ id_token: idToken }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A fresh ES256 key pair plus a JWKS wrapping its public half, so a test can sign an ID token and
 * verify it the way `GoogleIdentityProvider` does — without a network.
 */
async function googleKeySet() {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const kid = "test-key";
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: "ES256" };
  const jwks = createLocalJWKSet({ keys: [jwk] });

  return { privateKey, jwks, kid };
}

/** A signed Google ID token, verified email by default, overridable per test. */
async function googleIdToken(
  privateKey: CryptoKey,
  kid: string,
  claims: Record<string, unknown> = {},
): Promise<string> {
  return await new SignJWT({
    email: "person@example.com",
    email_verified: true,
    ...claims,
  })
    .setProtectedHeader({ alg: "ES256", kid })
    .setIssuer("https://accounts.google.com")
    .setAudience(CLIENT_ID)
    .setExpirationTime("5m")
    .sign(privateKey);
}

describe("FakeIdentityProvider", () => {
  it("authorizeUrl points at the fake login page and carries the state", () => {
    const provider: IdentityProvider = new FakeIdentityProvider();

    const url = provider.authorizeUrl("state-123", CALLBACK_URL);

    expect(url).toBeInstanceOf(URL);
    expect(url.pathname).toContain("fake-login");
    expect(url.searchParams.get("state")).toBe("state-123");
  });

  it("identityFromCallback returns the email from the callback query", async () => {
    const provider: IdentityProvider = new FakeIdentityProvider();
    const url = new URL(`${CALLBACK_URL}?state=state-123&email=person%40example.com`);

    const identity = await provider.identityFromCallback(url, CALLBACK_URL);

    expect(identity).toEqual({ email: "person@example.com" });
  });

  it("rejects when the callback carries no email", async () => {
    const provider: IdentityProvider = new FakeIdentityProvider();
    const url = new URL(`${CALLBACK_URL}?state=state-123`);

    await expect(provider.identityFromCallback(url, CALLBACK_URL)).rejects.toThrow();
  });
});

describe("GoogleIdentityProvider", () => {
  it("builds a Google authorization URL with response_type, client_id, redirect_uri, an openid+email scope, and state", () => {
    const provider = new GoogleIdentityProvider({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    const url = provider.authorizeUrl("state-123", CALLBACK_URL);

    expect(url.host).toBe("accounts.google.com");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(CALLBACK_URL);
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(
      expect.arrayContaining(["openid", "email"]),
    );
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.has("login_hint")).toBe(false);
  });

  it("carries login_hint only when given", () => {
    const provider = new GoogleIdentityProvider({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    const url = provider.authorizeUrl("state-123", CALLBACK_URL, "person@example.com");

    expect(url.searchParams.get("login_hint")).toBe("person@example.com");
  });

  it("exchanges the code with Google's token endpoint through the injected fetch and returns the verified email", async () => {
    const { privateKey, jwks, kid } = await googleKeySet();
    const idToken = await googleIdToken(privateKey, kid);
    const { fetch, calls } = stubFetch(tokenResponse(idToken));
    const provider = new GoogleIdentityProvider({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetch,
      jwks,
    });
    const url = new URL(`${CALLBACK_URL}?code=test-code&state=state-123`);

    const identity = await provider.identityFromCallback(url, CALLBACK_URL);

    expect(identity).toEqual({ email: "person@example.com" });
    expect(calls).toHaveLength(1);
    const request = calls[0];

    expect(request?.url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(await request?.text());

    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("test-code");
    expect(body.get("client_id")).toBe(CLIENT_ID);
    expect(body.get("client_secret")).toBe(CLIENT_SECRET);
    expect(body.get("redirect_uri")).toBe(CALLBACK_URL);
  });

  it("rejects an ID token whose email_verified is not true — an unverified email is nobody's proof", async () => {
    const { privateKey, jwks, kid } = await googleKeySet();
    const idToken = await googleIdToken(privateKey, kid, { email_verified: false });
    const { fetch } = stubFetch(tokenResponse(idToken));
    const provider = new GoogleIdentityProvider({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetch,
      jwks,
    });
    const url = new URL(`${CALLBACK_URL}?code=test-code&state=state-123`);

    await expect(provider.identityFromCallback(url, CALLBACK_URL)).rejects.toThrow();
  });

  it("rejects an ID token signed by a key that is not in the JWKS", async () => {
    const { jwks } = await googleKeySet();
    const { privateKey: otherKey } = await generateKeyPair("ES256", { extractable: true });
    const idToken = await new SignJWT({ email: "person@example.com", email_verified: true })
      .setProtectedHeader({ alg: "ES256", kid: "not-the-real-kid" })
      .setIssuer("https://accounts.google.com")
      .setAudience(CLIENT_ID)
      .setExpirationTime("5m")
      .sign(otherKey);
    const { fetch } = stubFetch(tokenResponse(idToken));
    const provider = new GoogleIdentityProvider({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetch,
      jwks,
    });
    const url = new URL(`${CALLBACK_URL}?code=test-code&state=state-123`);

    await expect(provider.identityFromCallback(url, CALLBACK_URL)).rejects.toThrow();
  });

  it("rejects an ID token whose aud is another client's", async () => {
    const { privateKey, jwks, kid } = await googleKeySet();
    const idToken = await new SignJWT({ email: "person@example.com", email_verified: true })
      .setProtectedHeader({ alg: "ES256", kid })
      .setIssuer("https://accounts.google.com")
      .setAudience("some-other-client")
      .setExpirationTime("5m")
      .sign(privateKey);
    const { fetch } = stubFetch(tokenResponse(idToken));
    const provider = new GoogleIdentityProvider({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetch,
      jwks,
    });
    const url = new URL(`${CALLBACK_URL}?code=test-code&state=state-123`);

    await expect(provider.identityFromCallback(url, CALLBACK_URL)).rejects.toThrow();
  });

  const badCallbacks = [
    ["an error instead of a code", `${CALLBACK_URL}?error=access_denied&state=state-123`],
    ["neither a code nor an error", `${CALLBACK_URL}?state=state-123`],
  ] as const;

  it.each(badCallbacks)("rejects a callback carrying %s", async (_label, href) => {
    const provider = new GoogleIdentityProvider({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });
    const url = new URL(href);

    await expect(provider.identityFromCallback(url, CALLBACK_URL)).rejects.toThrow();
  });

  it("rejects when Google's token endpoint answers non-2xx", async () => {
    const { fetch } = stubFetch(
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = new GoogleIdentityProvider({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetch,
    });
    const url = new URL(`${CALLBACK_URL}?code=test-code&state=state-123`);

    await expect(provider.identityFromCallback(url, CALLBACK_URL)).rejects.toThrow();
  });

  it("rejects when Google's token endpoint answers 200 with no id_token", async () => {
    const { fetch } = stubFetch(
      new Response(JSON.stringify({ access_token: "abc" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = new GoogleIdentityProvider({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetch,
    });
    const url = new URL(`${CALLBACK_URL}?code=test-code&state=state-123`);

    await expect(provider.identityFromCallback(url, CALLBACK_URL)).rejects.toThrow();
  });
});

describe("fakeLoginPage", () => {
  it("renders an HTML form with an email input and the state carried through", async () => {
    const response = fakeLoginPage("state-123");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/html/);
    expect(body).toMatch(/<form[^>]*>/);
    expect(body).toContain('name="email"');
    expect(body).toContain('name="state"');
    expect(body).toContain("state-123");
  });

  it("puts loginHint in the email field's value when given", async () => {
    const response = fakeLoginPage("state-123", { loginHint: "person@example.com" });
    const body = await response.text();

    expect(body).toContain('value="person@example.com"');
  });

  it("escapes the state and hint into the HTML rather than interpolating them raw", async () => {
    const dangerous = `"><script>alert(1)</script>`;
    const response = fakeLoginPage(dangerous, { loginHint: dangerous });
    const body = await response.text();

    expect(body).not.toContain("<script>alert(1)</script>");
  });

  it("renders the systemLabel when given, so the person can see which system they are signing in to", async () => {
    const response = fakeLoginPage("state-123", { systemLabel: "GrantPortal" });
    const body = await response.text();

    expect(body).toContain("GrantPortal");
  });

  it('renders with no literal "undefined" when systemLabel is omitted', async () => {
    const response = fakeLoginPage("state-123");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain("undefined");
  });

  it("escapes systemLabel into the HTML rather than interpolating it raw", async () => {
    const dangerous = `"><script>alert(1)</script>`;
    const response = fakeLoginPage("state-123", { systemLabel: dangerous });
    const body = await response.text();

    expect(body).not.toContain("<script>alert(1)</script>");
  });

  it("renders a password input alongside the email input", async () => {
    const response = fakeLoginPage("state-123");
    const body = await response.text();

    expect(body).toMatch(/<input[^>]*type="password"[^>]*>/);
  });

  it("gives the password input no name attribute, so the form submits no password value", async () => {
    const response = fakeLoginPage("state-123");
    const body = await response.text();
    const passwordInput = body.match(/<input[^>]*type="password"[^>]*>/)?.[0];

    expect(passwordInput).toBeDefined();
    expect(passwordInput).not.toContain("name=");
  });

  it("tells the person this page stands in for Google", async () => {
    const response = fakeLoginPage("state-123");
    const body = await response.text();

    expect(body).toMatch(/stand-in for Google/i);
  });
});
