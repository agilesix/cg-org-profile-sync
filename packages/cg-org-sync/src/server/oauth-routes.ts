import { SignJWT, base64url, jwtVerify, type JWTPayload } from "jose";
import { badRequest } from "./responses.js";
import type { IdentityProvider } from "./identity.js";
import { mintAccessToken, type SigningKey } from "./tokens.js";

/**
 * Each portal is its own OAuth authorization server.
 *
 * It delegates identity to a provider, decides for itself which organizations
 * that person may touch here, and mints its own access token. Nothing about
 * one system's answer is usable at another, which is the property the whole
 * demo turns on.
 *
 * **Everything is stateless.** Workers isolates share no memory, so there is
 * nowhere to keep a pending-authorizations map: the `state` sent to the
 * identity provider and the authorization code handed back to the client are
 * both short-lived JWTs signed with this system's own key, carrying what a
 * server-side map would otherwise have held.
 *
 * The cost is that a code is replayable for its sixty-second life — a real
 * authorization server marks one spent the first time it is redeemed, which
 * needs storage. Acceptable for a demo, and named here rather than discovered.
 */

/** The only client this demo issues tokens to. */
const CLIENT_ID = "link";

/** PKCE, S256 only. `plain` exists in the RFC and is not worth accepting. */
const CHALLENGE_METHOD = "S256";

/** Long enough to sign in with, short enough that a leaked state is worthless. */
const STATE_TTL_SECONDS = 300;

/** A code is redeemed immediately. Sixty seconds is generous. */
const CODE_TTL_SECONDS = 60;

/** Long enough for a demo session, short enough to be worth minting per person. */
const ACCESS_TOKEN_TTL_SECONDS = 600;

/** What a system needs to tell the OAuth handlers about itself. */
export interface OAuthConfig {
  /** This system's signing key. Signs the state, the code, and the access token. */
  key: SigningKey;

  /** This system's id — the `aud` of the access token it mints. */
  systemId: string;

  /** This system's own origin, used as `iss` and to build the provider callback URL. */
  issuer: string;

  identity: IdentityProvider;

  /**
   * Exact redirect URIs this system will send a code to.
   *
   * An allow-list rather than a pattern: the redirect is where the code goes,
   * so anything looser is a way to have one sent somewhere else.
   */
  redirectUris: readonly string[];

  /** Which orgs this email may touch here. Empty means no access. */
  grantsFor(email: string): readonly string[];

  /**
   * Where to report something that went wrong establishing identity.
   *
   * Every identity failure is the same `access_denied` to the client, so this
   * is the only place the reason exists. That matters most on the Google path,
   * which no test can reach: a wrong client secret, an unreachable JWKS or a
   * skewed clock all look identical from the outside, and without this there
   * is nothing to look at.
   */
  onProblem?: (problem: string, cause?: unknown) => void;
}

/**
 * `GET /oauth/authorize`
 *
 * Checks the request is one this system will honour, then hands the person to
 * the identity provider with everything it will need on the way back wrapped
 * in a signed state.
 *
 * A bad `redirect_uri` or `client_id` answers 400 rather than redirecting: the
 * redirect is the thing being validated, so there is nowhere trustworthy to
 * report the problem to. Parameter validation beyond this is deliberately not
 * spec-complete — the only client is Link, and this is a demo.
 */
export async function authorize(url: URL, config: OAuthConfig): Promise<Response> {
  const params = url.searchParams;

  if (params.get("client_id") !== CLIENT_ID) {
    return badRequest(`This system issues tokens to \`${CLIENT_ID}\` and no other client.`);
  }

  const redirectUri = params.get("redirect_uri");

  if (redirectUri === null || !config.redirectUris.includes(redirectUri)) {
    // Reported as well as refused. To whoever sent it this reads as their
    // mistake, and usually it is — but it is also exactly what an unset or
    // mistyped `LINK_ORIGIN` looks like from the outside, and that one is the
    // system's own fault and worth finding before a demo rather than during.
    config.onProblem?.(
      `refused an unregistered redirect_uri (${redirectUri ?? "none given"}); ` +
        `${config.redirectUris.length} registered`,
    );

    return badRequest("That `redirect_uri` is not registered with this system.");
  }

  const codeChallenge = params.get("code_challenge");

  if (!codeChallenge || params.get("code_challenge_method") !== CHALLENGE_METHOD) {
    return badRequest(`This system requires a \`${CHALLENGE_METHOD}\` \`code_challenge\`.`);
  }

  const loginHint = params.get("login_hint") ?? undefined;

  const state = await signShortLived(
    config,
    stateAudience(config),
    {
      code_challenge: codeChallenge,
      redirect_uri: redirectUri,
      link_state: params.get("state") ?? "",
    },
    STATE_TTL_SECONDS,
  );

  return redirect(config.identity.authorizeUrl(state, callbackUrl(config), loginHint));
}

/**
 * `GET /oauth/callback`
 *
 * Where the identity provider comes back. Turns a verified email into an
 * authorization code, or sends the client away with a reason.
 *
 * Nothing is trusted before the state verifies, because the state is what says
 * where a reply may be sent. Once it does, every outcome is a redirect — the
 * person is in a browser mid-flow, and a 400 rendered at them is a dead end.
 */
export async function callback(url: URL, config: OAuthConfig): Promise<Response> {
  const state = url.searchParams.get("state");

  if (!state) {
    return badRequest("That callback carries no state.");
  }

  let claims: JWTPayload;

  try {
    claims = await verifyShortLived(config, state, stateAudience(config));
  } catch {
    return badRequest("That callback's state did not come from this system, or has expired.");
  }

  const redirectUri = readString(claims, "redirect_uri");
  const linkState = readString(claims, "link_state") ?? "";
  const codeChallenge = readString(claims, "code_challenge");

  // Re-checked against the allow-list rather than trusted because it was
  // signed. A URI removed from the registry between the two legs of the flow
  // should stop receiving codes immediately.
  if (!redirectUri || !codeChallenge || !config.redirectUris.includes(redirectUri)) {
    return badRequest("That callback's state names a `redirect_uri` this system will not use.");
  }

  const providerError = url.searchParams.get("error");

  if (providerError) {
    return redirectBack(redirectUri, linkState, { error: providerError });
  }

  let email: string;

  try {
    ({ email } = await config.identity.identityFromCallback(url, callbackUrl(config)));
  } catch (cause) {
    // Every way identity can fail — a refused exchange, an unverified address,
    // a forged ID token — is the same answer to the client. Which one it was
    // goes to this system's log, not into a query parameter.
    config.onProblem?.("the identity provider did not establish an email", cause);

    return redirectBack(redirectUri, linkState, { error: "access_denied" });
  }

  const orgs = config.grantsFor(email);

  if (orgs.length === 0) {
    // The demo's negative beat: a real person, correctly signed in, who simply
    // has no standing on this system.
    return redirectBack(redirectUri, linkState, { error: "access_denied" });
  }

  const code = await signShortLived(
    config,
    codeAudience(config),
    { sub: email, orgs, code_challenge: codeChallenge, redirect_uri: redirectUri },
    CODE_TTL_SECONDS,
  );

  return redirectBack(redirectUri, linkState, { code });
}

/**
 * `POST /token`
 *
 * Trades an authorization code and its PKCE verifier for an access token.
 *
 * Answers the OAuth error shape rather than the CommonGrants envelope, since
 * this is an OAuth endpoint and a client that knows how to read one expects
 * `{ error }`. The errors carry no description on purpose: every one of them
 * means the code cannot be redeemed, and saying which part failed only tells a
 * sender what to change about the next attempt.
 */
export async function token(request: Request, config: OAuthConfig): Promise<Response> {
  let form: URLSearchParams;

  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return oauthError("invalid_request");
  }

  if (form.get("grant_type") !== "authorization_code") {
    return oauthError("unsupported_grant_type");
  }

  const code = form.get("code");
  const verifier = form.get("code_verifier");

  if (!code || !verifier) {
    return oauthError("invalid_request");
  }

  let claims: JWTPayload;

  try {
    claims = await verifyShortLived(config, code, codeAudience(config));
  } catch {
    return oauthError("invalid_grant");
  }

  if (form.get("redirect_uri") !== readString(claims, "redirect_uri")) {
    return oauthError("invalid_grant");
  }

  if ((await challengeFor(verifier)) !== readString(claims, "code_challenge")) {
    return oauthError("invalid_grant");
  }

  const sub = claims.sub;
  const orgs = readOrgs(claims);

  if (typeof sub !== "string" || orgs === undefined) {
    return oauthError("invalid_grant");
  }

  const accessToken = await mintAccessToken(
    config.key,
    { iss: config.issuer, aud: config.systemId, sub, orgs },
    ACCESS_TOKEN_TTL_SECONDS,
  );

  return new Response(
    JSON.stringify({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
    }),
    {
      status: 200,
      // RFC 6749 §5.1: a token response must never be cached.
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    },
  );
}

/**
 * The audiences that keep this system's three JWTs apart.
 *
 * All three are signed with the same key, so the audience is the only thing
 * stopping one from being spent as another — an authorization code presented
 * as a bearer token would otherwise verify, and it carries `sub` and `orgs`.
 */
const stateAudience = (config: OAuthConfig) => `${config.systemId}:oauth-state`;
const codeAudience = (config: OAuthConfig) => `${config.systemId}:oauth-code`;

/**
 * Where this system tells the identity provider to come back to.
 *
 * The issuer is trimmed first. It comes from a hand-edited environment
 * variable, and a trailing slash there would otherwise produce `//oauth/…`,
 * which Google rejects against its registered redirect URIs with nothing in
 * the request to explain why.
 */
const callbackUrl = (config: OAuthConfig) => `${trimSlashes(config.issuer)}/oauth/callback`;

/** An origin with any trailing slashes removed. */
const trimSlashes = (origin: string) => origin.replace(/\/+$/, "");

/** Sign one leg of the flow as a short-lived JWT. */
async function signShortLived(
  config: OAuthConfig,
  audience: string,
  payload: JWTPayload,
  ttlSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "ES256", kid: config.key.kid })
    .setIssuer(config.issuer)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(config.key.privateKey);
}

/** Verify one leg of the flow, or reject. */
async function verifyShortLived(
  config: OAuthConfig,
  jwt: string,
  audience: string,
): Promise<JWTPayload> {
  const { payload } = await jwtVerify(jwt, config.key.publicKey, {
    algorithms: ["ES256"],
    issuer: config.issuer,
    audience,
  });

  return payload;
}

/** The S256 challenge a verifier hashes to. */
async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));

  return base64url.encode(new Uint8Array(digest));
}

/** A 302 to `url`. */
function redirect(url: URL): Response {
  return new Response(null, { status: 302, headers: { location: url.toString() } });
}

/** A 302 back to the client, carrying either a code or a reason, and its state. */
function redirectBack(
  redirectUri: string,
  linkState: string,
  result: { code: string } | { error: string },
): Response {
  const url = new URL(redirectUri);

  if ("code" in result) {
    url.searchParams.set("code", result.code);
  } else {
    url.searchParams.set("error", result.error);
  }

  if (linkState) {
    url.searchParams.set("state", linkState);
  }

  return redirect(url);
}

/** The OAuth error shape: `{ error }`, and nothing that helps forge the next one. */
function oauthError(error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status: 400,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** One string claim, or `undefined` if it is missing or is not a string. */
function readString(claims: JWTPayload, name: string): string | undefined {
  const value = claims[name];

  return typeof value === "string" ? value : undefined;
}

/** The `orgs` claim as a grant, or `undefined` if it is not one. */
function readOrgs(claims: JWTPayload): readonly string[] | undefined {
  const orgs = claims["orgs"];

  if (Array.isArray(orgs) && orgs.every((org) => typeof org === "string")) {
    return orgs as string[];
  }

  return undefined;
}
