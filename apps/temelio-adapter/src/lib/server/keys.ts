import { createSigningKeyCache } from "@cg-link/org-sync/server";
import { env } from "$env/dynamic/private";

/**
 * This system's own ES256 signing key.
 *
 * Read from the environment rather than generated, because a key generated per
 * isolate would make `/.well-known/jwks.json` answer differently depending on
 * which isolate served it, and a token minted by one isolate would fail at the
 * next. One key per system, held in `SIGNING_KEY_JWK`, is what makes a token
 * minted here verifiable here and nowhere else.
 *
 * The caching and the fail-soft import live in `@cg-link/org-sync` because
 * `apps/*` has no test harness, and "'there is no key configured"' is exactly the
 * path worth pinning: it has to leave the system serving its service token and
 * refusing everything else, not answering 500 to every route.
 */
const cache = createSigningKeyCache((problem, cause) => {
  console.error(`SIGNING_KEY_JWK: ${problem}. This system verifies no access tokens.`);

  if (cause !== undefined) {
    console.error(cause);
  }
});

/** This system's signing key, or `undefined` when it has none it can use. */
export function signingKey() {
  return cache(env.SIGNING_KEY_JWK);
}
