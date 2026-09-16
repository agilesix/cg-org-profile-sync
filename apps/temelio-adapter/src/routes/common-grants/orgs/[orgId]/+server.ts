import { readOrg, updateOrg } from "@cg-link/org-sync/server";
import { routesFor } from "$lib/server/store.js";
import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = ({ params, locals }) =>
  readOrg(params.orgId, routesFor(locals.principal));

/**
 * A merge patch, applied to a vendor that has never heard of merge patches.
 *
 * The same shared handler the two portals use. Everything Temelio-specific
 * happens below it, in the store: the diff against what Temelio currently
 * holds, the single merge write, the re-read that says what was actually
 * stored.
 */
export const PATCH: RequestHandler = ({ params, request, locals }) =>
  updateOrg(params.orgId, request, routesFor(locals.principal));
