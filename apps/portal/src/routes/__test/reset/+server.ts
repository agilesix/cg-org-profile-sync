import { resetStore } from "@cg-link/org-sync/server";
import { env } from "$env/dynamic/private";
import { error } from "@sveltejs/kit";
import { store } from "$lib/server/store.js";
import type { RequestHandler } from "./$types.js";

/**
 * `POST /__test/reset` — put the store back to its seed, for the e2e suite.
 *
 * Behind `ENABLE_TEST_ROUTES` rather than a build flag so the guard is one
 * readable line. Answering 404 rather than 403 when the flag is off is the
 * point: an unflagged system should look like it has no such route at all.
 * The variable is deliberately absent from `wrangler.jsonc`, so a deploy has
 * no way to turn it on.
 *
 * Not behind the bearer guard — the flag is the gate, and the e2e suite should
 * be able to reset a system it has no credential for.
 */
export const POST: RequestHandler = () => {
  if (env.ENABLE_TEST_ROUTES !== "true") {
    error(404, "Not Found");
  }

  return resetStore(store);
};
