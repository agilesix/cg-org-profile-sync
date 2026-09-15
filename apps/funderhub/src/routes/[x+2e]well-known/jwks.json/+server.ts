import { failure, jwks } from "@cg-link/org-sync/server";
import { signingKey } from "$lib/server/keys.js";
import type { RequestHandler } from "./$types.js";

/**
 * `GET /.well-known/jwks.json` — this system's public keys.
 *
 * Unauthenticated, because a public key is public: anyone holding a token this
 * system minted must be able to verify it without a credential of their own.
 *
 * The directory is spelled `[x+2e]well-known` because SvelteKit's router skips
 * anything beginning with a dot; `[x+2e]` is its hex escape for one.
 *
 * A system with no usable key answers 500 rather than an empty key set. An
 * empty `keys` array is a valid JWKS meaning "this system has rotated away
 * every key", which is a different and much quieter lie than "this system is
 * misconfigured".
 */
export const GET: RequestHandler = async () => {
  const key = await signingKey();

  return key
    ? jwks(key)
    : failure(500, "This system has no signing key configured, so it publishes none.");
};
