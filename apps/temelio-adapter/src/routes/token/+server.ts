import { failure, token } from "@cg-link/org-sync/server";
import { oauthConfig } from "$lib/server/oauth.js";
import type { RequestHandler } from "./$types.js";

/**
 * `POST /token` — trade an authorization code for this system's access token.
 *
 * Promised on the landing page since the scaffold; real as of #1188-T2.
 */
export const POST: RequestHandler = async ({ request, url }) => {
  const config = await oauthConfig(url);

  return config
    ? token(request, config)
    : failure(500, "This system has no signing key configured, so it issues no tokens.");
};
