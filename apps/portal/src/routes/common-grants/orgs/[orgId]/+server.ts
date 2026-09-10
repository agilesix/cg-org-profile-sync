import { readOrg, updateOrg } from "@cg-link/org-sync/server";
import { orgRoutes } from "$lib/server/store.js";
import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = ({ params }) => readOrg(params.orgId, orgRoutes);

export const PATCH: RequestHandler = ({ params, request }) =>
  updateOrg(params.orgId, request, orgRoutes);
