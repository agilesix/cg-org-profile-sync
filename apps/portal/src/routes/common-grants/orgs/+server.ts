import { listOrgs } from "@cg-link/org-sync/server";
import { orgRoutes } from "$lib/server/store.js";
import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = ({ url }) => listOrgs(url, orgRoutes);
