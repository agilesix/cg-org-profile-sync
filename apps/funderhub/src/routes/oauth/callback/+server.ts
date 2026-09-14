import { callback, failure } from "@cg-link/org-sync/server";
import { oauthConfig } from "$lib/server/oauth.js";
import type { RequestHandler } from "./$types.js";

/**
 * `GET /oauth/callback` — where the identity provider comes back.
 *
 * One handler for both providers. The fake login form submits here too, so the
 * demo path and the Google path converge rather than forking.
 */
export const GET: RequestHandler = async ({ url }) => {
  const config = await oauthConfig(url);

  return config
    ? callback(url, config)
    : failure(500, "This system has no signing key configured, so it issues no tokens.");
};
