import { unauthorized } from "./responses.js";
import { type Principal, type SigningKey, verifyAccessToken } from "./tokens.js";

/**
 * What a system accepts as proof of who is calling.
 *
 * Two credentials, deliberately: an access token this system minted itself,
 * which carries a person and the orgs they may touch, and one static service
 * token with nobody behind it. The JWT is the real answer — `requireAccess`
 * below is what the demo runs on. The static token stays because the `curl`
 * block and the API specs need a credential that can be typed by hand, and
 * because a system that can only be reached through an OAuth round trip is
 * one nobody can debug at a terminal.
 *
 * The static comparison is not constant-time. Against a demo secret on
 * localhost that is an accepted trade; the JWT path, which is where real
 * credentials live, does not compare secrets at all.
 */

/** `Bearer` is case-insensitive per RFC 7235; the token itself is not. */
const BEARER = /^Bearer +(?<token>\S+)$/i;

/**
 * Who the static service credential is.
 *
 * `"*"` because there is no person to scope it to — it is the system's own
 * key to itself. Frozen so a handler that received it cannot narrow the shared
 * instance for everyone after it.
 */
const SERVICE_PRINCIPAL: Principal = Object.freeze({ sub: "service", orgs: "*" });

/**
 * Check a request's bearer token against the one this system expects.
 *
 * Returns a 401 envelope to send back as-is, or `undefined` when the caller may
 * proceed, so a SvelteKit hook reads as
 * `return requireBearer(event.request, env.TOKEN) ?? resolve(event)`.
 *
 * Kept for callers that want a yes-or-no on a shared secret and have no use for
 * a principal — `POST /__test/reset` and anything else outside the org routes.
 */
export function requireBearer(
  request: Request,
  expectedToken: string | undefined,
): Response | undefined {
  // No configured token means the system booted without its secret. Fail
  // closed: the alternative is a missing `.env` quietly opening every route.
  if (!expectedToken) {
    return unauthorized("This system has no access token configured, so it accepts no requests.");
  }

  const token = readBearer(request);

  if (token instanceof Response) {
    return token;
  }

  if (token !== expectedToken) {
    return unauthorized("That access token is not valid for this system.");
  }

  return undefined;
}

/** What a system needs to know to identify a caller. */
export interface AccessOptions {
  /**
   * This system's signing key, or `undefined` when it has none configured.
   *
   * Without it no JWT can be verified, so only the service token is accepted —
   * which is what keeps a system whose `SIGNING_KEY_JWK` is unset or malformed
   * usable from a terminal while it fails closed to everyone else.
   */
  key: SigningKey | undefined;

  /** This system's own id, which a token must name as its `aud`. */
  audience: string;

  /** The static service credential, if this system issues one. */
  serviceToken?: string;
}

/**
 * Identify whoever is calling, or refuse them.
 *
 * Resolves to a `Principal` the caller should proceed as, or to the 401
 * envelope it should return unchanged, so a SvelteKit hook reads as:
 *
 * ```ts
 * const principal = await requireAccess(event.request, { key, audience, serviceToken });
 * if (principal instanceof Response) return principal;
 * event.locals.principal = principal;
 * ```
 *
 * Async, unlike `requireBearer` — verifying a signature is.
 */
export async function requireAccess(
  request: Request,
  { key, audience, serviceToken }: AccessOptions,
): Promise<Principal | Response> {
  // Neither credential configured means the system booted without its secrets.
  // Same fail-closed reasoning as `requireBearer`, checked before the header so
  // a misconfigured system answers the same way to every caller.
  if (!key && !serviceToken) {
    return unauthorized("This system has no access token configured, so it accepts no requests.");
  }

  const token = readBearer(request);

  if (token instanceof Response) {
    return token;
  }

  if (serviceToken !== undefined && token === serviceToken) {
    return SERVICE_PRINCIPAL;
  }

  if (!key) {
    return unauthorized("This system cannot verify access tokens, so it accepts none.");
  }

  try {
    return await verifyAccessToken(key, token, { audience });
  } catch {
    // Every way a token can fail — forged, expired, minted for another system,
    // missing its grant — answers the same sentence. Saying which would tell a
    // sender what to change about the next one.
    return unauthorized("That access token is not valid for this system.");
  }
}

/** The bearer token on a request, or the 401 to send back instead of reading one. */
function readBearer(request: Request): string | Response {
  const header = request.headers.get("authorization");

  if (header === null) {
    return unauthorized("This request needs an `Authorization: Bearer <token>` header.");
  }

  const token = BEARER.exec(header)?.groups?.token;

  if (token === undefined) {
    return unauthorized("The `Authorization` header must use the Bearer scheme.");
  }

  return token;
}
