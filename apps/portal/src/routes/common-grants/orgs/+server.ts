import { listOrgs } from "@cg-link/org-sync/server";
import { routesFor } from "$lib/server/store.js";
import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = ({ url, locals }) => listOrgs(url, routesFor(locals.principal));
