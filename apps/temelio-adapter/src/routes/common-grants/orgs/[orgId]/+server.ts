import { readOrg } from "@cg-link/org-sync/server";
import { routesFor } from "$lib/server/store.js";
import type { RequestHandler } from "./$types.js";

/**
 * Read only, for now.
 *
 * No `PATCH` export, so SvelteKit answers 405 to one — which is the honest
 * answer while the adapter is read-only, and a stronger claim than a handler
 * that accepted a patch and did nothing with it. #1190-T4 adds the write.
 */
export const GET: RequestHandler = ({ params, locals }) =>
  readOrg(params.orgId, routesFor(locals.principal));
