import { SignJWT, calculateJwkThumbprint, importJWK, jwtVerify, type JWK } from "jose";

/**
 * Each system signs its own access tokens.
 *
 * The point of a per-system credential is that one lifted from another system
 * is useless, and a static shared secret can only promise that by convention.
 * An ES256 JWT makes it structural: the token names its audience, the receiver
 * verifies it against its own public key, and a token minted by GrantPortal
 * fails at FunderHub because FunderHub never had the key that signed it.
 *
 * ES256 rather than RS256 because the keys and the tokens are both smaller and
 * WebCrypto on the Workers runtime supports it natively; and asymmetric rather
 * than HS256 because `GET /.well-known/jwks.json` is the whole point — anyone
 * can verify this system's tokens, and only this system can mint them.
 */

/** The one algorithm this demo signs and verifies with. */
const ES256 = "ES256";

/** Five minutes. Long enough to survive a demo click path, short enough to matter. */
const DEFAULT_TTL_SECONDS = 300;

/**
 * Who a request is, and which organizations they may touch.
 *
 * `"*"` means every org — what the static service credential gets, since there
 * is no person behind it to scope it to. A principal whose `orgs` is an empty
 * array is a real person with no grant on this system, which is the case the
 * demo turns on: they see an empty list rather than an error.
 */
export interface Principal {
  /** Stable id of whoever the token was minted for. */
  sub: string;

  /** Org ids this principal may touch, or `"*"` for all of them. */
  orgs: readonly string[] | "*";
}

/** A system's ES256 signing key, imported once from its private JWK. */
export interface SigningKey {
  /**
   * RFC 7638 JWK thumbprint of the public half.
   *
   * A thumbprint rather than a random id so the same JWK always yields the same
   * `kid`: two isolates booting from the same `SIGNING_KEY_JWK` must publish the
   * same JWKS, or a token minted by one fails at the other.
   */
  kid: string;

  privateKey: CryptoKey;
  publicKey: CryptoKey;

  /** The public half, ready to publish. Never carries the private scalar. */
  publicJwk: JsonWebKey;
}

/** The claims a system puts in its own access tokens. */
export interface AccessTokenClaims {
  /** The system that minted this token. */
  iss: string;

  /** The system this token is good at, and nowhere else. */
  aud: string;

  /** Who the token was minted for. */
  sub: string;

  /** Org ids the bearer may touch, or `"*"`. */
  orgs: readonly string[] | "*";
}

/**
 * Import a system's private ES256 JWK.
 *
 * Rejects on anything that is not one, so a malformed `SIGNING_KEY_JWK` is a
 * startup-shaped failure the caller can turn into a 401 and a log line, rather
 * than a key that half-works until the first signature.
 */
export async function loadSigningKey(jwk: string): Promise<SigningKey> {
  const parsed: unknown = JSON.parse(jwk);

  if (!isEcPrivateJwk(parsed)) {
    throw new Error("A signing key must be a private ES256 JWK: kty EC, crv P-256, with x, y, d.");
  }

  // Rebuilt field by field rather than by deleting `d` from a clone. The
  // published half and the thumbprint are both derived from this object, so it
  // has to be exactly the four RFC 7638 members and nothing the caller slipped
  // in alongside them.
  const publicJwk = { kty: parsed.kty, crv: parsed.crv, x: parsed.x, y: parsed.y };

  const [privateKey, publicKey, kid] = await Promise.all([
    importKey(parsed),
    importKey(publicJwk),
    calculateJwkThumbprint(publicJwk),
  ]);

  return { kid, privateKey, publicKey, publicJwk };
}

/** Sign a short-lived access token for this system. */
export async function mintAccessToken(
  key: SigningKey,
  claims: AccessTokenClaims,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string> {
  // `exp` computed from one `now` rather than left to a relative string, so a
  // caller can mint an already-expired token — which is how the suite pins the
  // expiry path without sleeping through it.
  const now = Math.floor(Date.now() / 1000);

  return await new SignJWT({ orgs: claims.orgs })
    .setProtectedHeader({ alg: ES256, kid: key.kid })
    .setIssuer(claims.iss)
    .setAudience(claims.aud)
    .setSubject(claims.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(key.privateKey);
}

/**
 * Verify a token against this system's key and audience.
 *
 * Rejects on a bad signature, another system's `aud`, an expired `exp`, a `kid`
 * that is not this key's, or an `orgs` claim that is not a grant. Every one of
 * those is a 401 to the caller; distinguishing them for the sender would only
 * tell an attacker which part of the forgery to fix.
 */
export async function verifyAccessToken(
  key: SigningKey,
  token: string,
  { audience }: { audience: string },
): Promise<Principal> {
  const { payload, protectedHeader } = await jwtVerify(token, key.publicKey, {
    algorithms: [ES256],
    audience,
  });

  // Key rotation is out of scope, so this system has exactly one key. A token
  // naming a different one is refused rather than looked up.
  if (protectedHeader.kid !== key.kid) {
    throw new Error("That token names a signing key this system does not have.");
  }

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("That token has no subject.");
  }

  return { sub: payload.sub, orgs: readOrgs(payload["orgs"]) };
}

/**
 * `GET /.well-known/jwks.json` — this system's public keys.
 *
 * Deliberately not the CommonGrants envelope: a JWKS is RFC 7517 shaped, and
 * every client that knows how to read one expects `{ keys: [...] }` at the top
 * level. Unauthenticated, because a public key is public.
 */
export function jwks(key: SigningKey): Response {
  const body = { keys: [{ ...key.publicJwk, alg: ES256, use: "sig", kid: key.kid }] };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** An `orgs` claim, or a refusal. A half-read grant must never become a principal. */
function readOrgs(claim: unknown): readonly string[] | "*" {
  if (claim === "*") {
    return "*";
  }

  if (Array.isArray(claim) && claim.every((org) => typeof org === "string")) {
    return claim as string[];
  }

  throw new Error('That token\'s `orgs` claim is neither "*" nor a list of org ids.');
}

/** The four members of an EC public JWK, plus the private scalar. */
interface EcPrivateJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  d: string;
}

function isEcPrivateJwk(value: unknown): value is EcPrivateJwk {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const jwk = value as Record<string, unknown>;

  return (
    jwk["kty"] === "EC" &&
    jwk["crv"] === "P-256" &&
    typeof jwk["x"] === "string" &&
    typeof jwk["y"] === "string" &&
    typeof jwk["d"] === "string"
  );
}

/**
 * Import one JWK as a WebCrypto key.
 *
 * `importJWK` can also hand back raw bytes — for an `oct` key, which the shape
 * check above has already ruled out. The narrowing is here so a future caller
 * that skips that check fails loudly rather than signing with a Uint8Array.
 */
async function importKey(jwk: JsonWebKey): Promise<CryptoKey> {
  const key = await importJWK(jwk as JWK, ES256);

  if (!(key instanceof CryptoKey)) {
    throw new Error("A signing key must be an asymmetric ES256 key.");
  }

  return key;
}

/**
 * A memoized importer for one system's signing key.
 *
 * A system reads its key from the environment, and on the Workers runtime the
 * environment is only populated inside a request — so the import cannot happen
 * at module load, and doing it per request would put a WebCrypto import in the
 * hot path. This caches the derived key against the value it came from: a
 * fresh isolate imports once, a changed value re-imports, and nothing assumes
 * an isolate outlives anything.
 *
 * Resolves to `undefined` rather than rejecting when there is no usable key,
 * so the guard can fail closed — a system that cannot verify tokens accepts
 * none — instead of turning a missing variable into a 500 on every route. That
 * distinction is the whole reason this is here rather than inline in an app:
 * the unconfigured value is `undefined`, which is also an empty cache's own
 * value, and the two are easy to conflate somewhere nothing can test it.
 *
 * `onProblem` is called once per distinct value, not once per request, and is
 * where the caller names the environment variable it reads — that sentence
 * belongs in the system's log, not in a reply to whoever was refused.
 */
export function createSigningKeyCache(
  onProblem: (problem: string, cause?: unknown) => void,
): (jwk: string | undefined) => Promise<SigningKey | undefined> {
  let cached: { jwk: string | undefined; key: Promise<SigningKey | undefined> } | undefined;

  return (jwk) => {
    // `cached === undefined` is checked on its own, not folded into
    // `cached?.jwk !== jwk`: when nothing is configured both sides of that
    // comparison are `undefined`, so the cache would never fill.
    if (cached === undefined || cached.jwk !== jwk) {
      cached = { jwk, key: importOrReport(jwk, onProblem) };
    }

    return cached.key;
  };
}

/** Import the key, or say what is wrong with it and carry on without one. */
async function importOrReport(
  jwk: string | undefined,
  onProblem: (problem: string, cause?: unknown) => void,
): Promise<SigningKey | undefined> {
  if (!jwk) {
    onProblem("no signing key is configured");
    return undefined;
  }

  try {
    return await loadSigningKey(jwk);
  } catch (cause) {
    onProblem("the configured signing key is not a private ES256 JWK", cause);
    return undefined;
  }
}
