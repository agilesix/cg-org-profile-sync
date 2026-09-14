import { requireAccess } from "@cg-link/org-sync/server";
import { env } from "$env/dynamic/private";
import type { Handle } from "@sveltejs/kit";
import { signingKey } from "$lib/server/keys.js";
import { SYSTEM_ID } from "$lib/server/store.js";

/**
 * Identify whoever is calling every CommonGrants route, or refuse them.
 *
 * Here rather than in each `+server.ts` so a route added later cannot forget
 * it. `requireAccess` reads headers only — a hook that touched the body would
 * consume it before `updateOrg` could parse the patch.
 *
 * Two credentials are accepted: an access token this system minted, whose
 * `aud` is `SYSTEM_ID` and whose claims say which orgs the bearer may touch,
 * and the static `CG_ACCESS_TOKEN`, which has no person behind it and is
 * scoped to everything. The second is what keeps the `curl` block and the API
 * specs working; the first is what the demo is about.
 *
 * The principal lands on `event.locals` rather than being re-derived in each
 * route: verifying a signature twice per request would be the only difference.
 *
 * `/__test/` is deliberately outside this: it is gated by its own env flag.
 */
export const handle: Handle = async ({ event, resolve }) => {
  if (event.url.pathname.startsWith("/common-grants/")) {
    const principal = await requireAccess(event.request, {
      key: await signingKey(),
      audience: SYSTEM_ID,
      serviceToken: env.CG_ACCESS_TOKEN,
    });

    if (principal instanceof Response) {
      return principal;
    }

    event.locals.principal = principal;
  }

  return resolve(event);
};
