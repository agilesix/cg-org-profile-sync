import { unauthorized } from "./responses.js";

/**
 * A static shared secret per system.
 *
 * Not where this ends up: each system should mint its own JWT with its own
 * `aud`, so a token lifted from one is useless against another. What the static
 * token already demonstrates is the shape that matters for the demo — one
 * credential per source, held by the widget's server and never by the browser —
 * and it keeps `POST /token` an honest future ticket rather than a stub nobody
 * calls.
 *
 * The comparison below is not constant-time. Against a static secret on a
 * localhost demo that is an accepted trade; a real deployment wants the JWT
 * verification that replaces this, not a timing-safe compare bolted onto it.
 */

/** `Bearer` is case-insensitive per RFC 7235; the token itself is not. */
const BEARER = /^Bearer +(?<token>\S+)$/i;

/**
 * Check a request's bearer token against the one this system expects.
 *
 * Returns a 401 envelope to send back as-is, or `undefined` when the caller may
 * proceed, so a SvelteKit hook reads as
 * `return requireBearer(event.request, env.TOKEN) ?? resolve(event)`.
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

  const header = request.headers.get("authorization");

  if (header === null) {
    return unauthorized("This request needs an `Authorization: Bearer <token>` header.");
  }

  const token = BEARER.exec(header)?.groups?.token;

  if (token === undefined) {
    return unauthorized("The `Authorization` header must use the Bearer scheme.");
  }

  if (token !== expectedToken) {
    return unauthorized("That access token is not valid for this system.");
  }

  return undefined;
}
