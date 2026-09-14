import { readOrg, updateOrg } from "@cg-link/org-sync/server";
import { routesFor } from "$lib/server/store.js";
import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = ({ params, locals }) =>
  readOrg(params.orgId, routesFor(locals.principal));

export const PATCH: RequestHandler = ({ params, request, locals }) =>
  updateOrg(params.orgId, request, routesFor(locals.principal));
