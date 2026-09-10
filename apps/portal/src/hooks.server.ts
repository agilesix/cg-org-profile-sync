import { requireBearer } from "@cg-link/org-sync/server";
import { env } from "$env/dynamic/private";
import type { Handle } from "@sveltejs/kit";

/**
 * Guard every CommonGrants route with this system's access token.
 *
 * Here rather than in each `+server.ts` so a route added later cannot forget
 * it. `requireBearer` reads headers only — a hook that touched the body would
 * consume it before `updateOrg` could parse the patch.
 *
 * `/__test/` is deliberately outside this: it is gated by its own env flag.
 */
export const handle: Handle = ({ event, resolve }) => {
  if (event.url.pathname.startsWith("/common-grants/")) {
    return requireBearer(event.request, env.CG_ACCESS_TOKEN) ?? resolve(event);
  }

  return resolve(event);
};
