import { compareAcrossSources } from "@cg-link/org-sync/client";
import { DEFAULT_EIN, EIN_REGISTRY } from "$lib/demo.js";
import { SOURCES, tokenProvider } from "$lib/server/sources.js";
import type { PageServerLoad } from "./$types.js";

/**
 * Read every system before the page is sent, so the grid paints filled in.
 *
 * Calls `compareAcrossSources` directly rather than fetching Link's own
 * `/api/compare`: the route is a thin wrapper over this same function, and a
 * server asking itself over HTTP would only add a hop. The browser does use
 * the route — that is what a refresh after a sync goes through — so both paths
 * stay exercised.
 *
 * `?registry=` and `?id=` are honoured so a demo can be deep-linked at a
 * particular org, and the resolved pair is handed back for the page to echo
 * into its lookup field.
 */
export const load: PageServerLoad = async ({ url }) => {
  const registry = url.searchParams.get("registry") || EIN_REGISTRY;
  const id = url.searchParams.get("id") || DEFAULT_EIN;

  const comparison = await compareAcrossSources(registry, id, {
    sources: SOURCES,
    tokens: tokenProvider(),
  });

  return { registry, id, comparison };
};
