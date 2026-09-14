import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type KeyObject } from "jose";

/**
 * Who a portal asks about the person in front of it.
 *
 * The contract is deliberately "give me a verified email", not "give me an ID
 * token". A portal does not care how identity was established, only who it
 * belongs to — which is what lets the demo swap Google for a form on a page
 * without the OAuth handlers noticing, and what lets the fake provider exist
 * without a signing key of its own.
 */

/** Google's OpenID endpoints. Fixed, so nothing has to configure them. */
const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

/** Google signs its ID tokens as either of these. */
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/** What the demo needs from a person: an address to look their grants up by. */
export interface Identity {
  email: string;
}

export interface IdentityProvider {
  /** Where to send someone to prove who they are. */
  authorizeUrl(state: string, callbackUrl: string, loginHint?: string): URL;

  /**
   * What the callback says about them.
   *
   * Rejects rather than returning a partial identity: a caller about to look
   * up someone's grants must never be handed an empty email to look up.
   */
  identityFromCallback(url: URL, callbackUrl: string): Promise<Identity>;
}

export interface GoogleIdentityProviderOptions {
  clientId: string;
  clientSecret: string;

  /** Injected so tests stub the transport rather than the global. */
  fetch?: typeof globalThis.fetch;

  /**
   * Where Google's public keys come from.
   *
   * Injected so a test can verify a real signature against a local key set
   * instead of reaching the network. Defaults to Google's published JWKS.
   */
  jwks?: JWTVerifyGetKey | CryptoKey | KeyObject | Uint8Array;
}

/** Identity by Google sign-in: the demo's real provider. */
export class GoogleIdentityProvider implements IdentityProvider {
  #clientId: string;
  #clientSecret: string;
  #fetch: typeof globalThis.fetch;
  #jwks: JWTVerifyGetKey | CryptoKey | KeyObject | Uint8Array;

  constructor(options: GoogleIdentityProviderOptions) {
    this.#clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#jwks = options.jwks ?? googleJwks();
  }

  authorizeUrl(state: string, callbackUrl: string, loginHint?: string): URL {
    const url = new URL(GOOGLE_AUTHORIZE_URL);

    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.#clientId);
    url.searchParams.set("redirect_uri", callbackUrl);
    url.searchParams.set("scope", "openid email");
    url.searchParams.set("state", state);

    if (loginHint) {
      // Google pre-fills the account chooser with this, so the second portal
      // in the demo is one click rather than a second sign-in.
      url.searchParams.set("login_hint", loginHint);
    }

    return url;
  }

  async identityFromCallback(url: URL, callbackUrl: string): Promise<Identity> {
    const code = readCallbackCode(url);
    const idToken = await this.#exchange(code, callbackUrl);

    const { payload } = await jwtVerify(idToken, this.#jwks, {
      issuer: GOOGLE_ISSUERS,
      audience: this.#clientId,
    });

    // `email_verified` is the one claim holding the grant model up. Without it
    // anyone could sign up to Google with someone else's address and inherit
    // whatever that address is granted here.
    if (payload["email_verified"] !== true) {
      throw new Error("Google has not verified that email address.");
    }

    const email = payload["email"];

    if (typeof email !== "string" || email.length === 0) {
      throw new Error("Google's ID token carries no email address.");
    }

    return { email };
  }

  /** Trade the authorization code for an ID token. */
  async #exchange(code: string, callbackUrl: string): Promise<string> {
    const response = await this.#fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: this.#clientId,
        client_secret: this.#clientSecret,
        redirect_uri: callbackUrl,
      }),
    });

    if (!response.ok) {
      throw new Error(`Google refused the code exchange with ${response.status}.`);
    }

    const body: unknown = await response.json();
    const idToken = (body as { id_token?: unknown } | null)?.id_token;

    if (typeof idToken !== "string") {
      throw new Error("Google's token response carries no ID token.");
    }

    return idToken;
  }
}

/**
 * Identity by typing an address into a form.
 *
 * For the demo and for the tests. It proves nothing — which is exactly why it
 * is behind an environment flag the app must set deliberately, and why it is
 * the provider the e2e suite uses rather than one that needs a Google account.
 */
export class FakeIdentityProvider implements IdentityProvider {
  authorizeUrl(state: string, callbackUrl: string, loginHint?: string): URL {
    // The login page lives alongside the callback, so a system only has to
    // know one origin for the whole fake flow.
    const url = new URL("../fake-login", `${callbackUrl}/`);

    url.searchParams.set("state", state);

    if (loginHint) {
      url.searchParams.set("login_hint", loginHint);
    }

    return url;
  }

  /**
   * Takes no callback URL, unlike the interface it satisfies: there is nothing
   * to exchange, which is the whole difference between this provider and a
   * real one. Callers go through `IdentityProvider`, which still passes one.
   */
  async identityFromCallback(url: URL): Promise<Identity> {
    const email = url.searchParams.get("email");

    if (!email) {
      throw new Error("The fake login form submitted no email address.");
    }

    return { email };
  }
}

/**
 * The dev-only sign-in form.
 *
 * Submits straight back to the callback, so the fake flow and the Google flow
 * converge on the same handler rather than the fake one having its own path
 * through the portal.
 */
export function fakeLoginPage(state: string, loginHint?: string): Response {
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Sign in</title>
  </head>
  <body>
    <main>
      <h1>Sign in</h1>
      <p>Stand-in for Google. Any address works; what you are granted depends on who you say you are.</p>
      <form method="GET" action="callback">
        <input type="hidden" name="state" value="${escapeHtml(state)}" />
        <label for="email">Email</label>
        <input id="email" type="email" name="email" value="${escapeHtml(loginHint ?? "")}" required />
        <button type="submit">Continue</button>
      </form>
    </main>
  </body>
</html>`;

  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/** The code on a provider's callback, or a refusal naming what came instead. */
function readCallbackCode(url: URL): string {
  const error = url.searchParams.get("error");

  if (error) {
    throw new Error(`The identity provider refused with ${error}.`);
  }

  const code = url.searchParams.get("code");

  if (!code) {
    throw new Error("The identity provider's callback carries neither a code nor an error.");
  }

  return code;
}

/**
 * Google's published keys, fetched on first use and cached by `jose` after.
 *
 * Module-level rather than per provider. A portal builds a fresh
 * `GoogleIdentityProvider` on every request — it has to, since the environment
 * it reads its client id from is only populated inside one — so a resolver
 * held on the instance would be thrown away before it cached anything, and
 * every sign-in would re-fetch Google's keys. Keyed by nothing because the
 * URL is a constant, and safe as isolate-scoped state for the same reason the
 * signing key cache is: a fresh isolate simply builds it again.
 *
 * Built on first use rather than at module load so importing this module is
 * never what opens a connection.
 */
let resolver: JWTVerifyGetKey | undefined;

function googleJwks(): JWTVerifyGetKey {
  return async (header, input) => {
    resolver ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

    return await resolver(header, input);
  };
}

/** Escape a value for interpolation into HTML text or a double-quoted attribute. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
