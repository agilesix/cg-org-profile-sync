import { authorize, failure } from "@cg-link/org-sync/server";
import { oauthConfig } from "$lib/server/oauth.js";
import type { RequestHandler } from "./$types.js";

/**
 * `GET /oauth/authorize` — the start of this system's own OAuth flow.
 *
 * Unauthenticated by construction: the guard in `hooks.server.ts` covers
 * `/common-grants/` and nothing else, and a sign-in route that required a
 * credential would have nowhere to get one.
 */
export const GET: RequestHandler = async ({ url }) => {
  const config = await oauthConfig(url);

  return config
    ? authorize(url, config)
    : failure(500, "This system has no signing key configured, so it issues no tokens.");
};
